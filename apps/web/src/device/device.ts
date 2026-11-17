import {
  Command,
  assembleConfig,
  decodeActiveProfile,
  decodeBatteryReply,
  decodeDisplayBlock,
  decodeSettingsBlock,
  decodeStages,
  pingFrame,
  readActiveProfileFrame,
  readBatteryFrame,
  readConfigFrames,
  readDisplayFrame,
  writeConfigPatch,
  writeDisplayFrame,
} from "@beastx-ctl/protocol";
import type {
  Battery,
  DisplayBlock,
  DisplayPatch,
  DpiStage,
  Settings,
  SettingsPatch,
  StagePatch,
} from "@beastx-ctl/protocol";
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Ref,
  Result,
  Semaphore,
} from "effect";

import {
  BackupRequired,
  ExperimentalOff,
  NotReady,
  WriteMismatch,
} from "./errors";
import type { DeviceError } from "./errors";
import { exchange } from "./exchange";
import { GateStore } from "./gate-store";
import type { StoredGate } from "./gate-store";
import { Transport } from "./transport";

const PING_READY = 0xff;

export interface BackupInput {
  readonly battery: typeof Battery.Type;
  readonly config: Uint8Array;
  readonly display: Uint8Array;
  readonly profile: number;
}

export interface DeviceRead {
  readonly battery: typeof Battery.Type;
  readonly display: typeof DisplayBlock.Type;
  readonly profile: number;
  readonly settings: typeof Settings.Type;
  readonly stages: readonly (typeof DpiStage.Type)[];
}

export type WriteRead = Omit<DeviceRead, "battery">;

interface LinkStatus {
  readonly battery: typeof Battery.Type | undefined;
  readonly ready: boolean;
}

export interface DeviceApi {
  readonly backup: <E>(
    save: (input: BackupInput) => Effect.Effect<void, E>
  ) => Effect.Effect<void, DeviceError | E>;
  readonly gate: Effect.Effect<Gate>;
  readonly read: Effect.Effect<DeviceRead, DeviceError>;
  readonly setExperimental: (on: boolean) => Effect.Effect<void, DeviceError>;
  readonly status: Effect.Effect<LinkStatus, DeviceError>;
  readonly writeDisplay: (
    patch: DisplayPatch
  ) => Effect.Effect<typeof DisplayBlock.Type, DeviceError>;
  readonly writeSettings: (
    patch: SettingsPatch
  ) => Effect.Effect<WriteRead, DeviceError>;
}

interface Gate {
  readonly backedUp: boolean;
  readonly experimental: boolean;
}

const CONFIRMED_FIELDS = ["liftOff", "pollingIndex"] as const;

const SCALAR_FIELDS = [
  "activeStage",
  "debounceMs",
  "liftOff",
  "motionSync",
  "pollingIndex",
  "sleepSeconds",
] as const;

const touchesExperimental = (patch: SettingsPatch): boolean =>
  patch.stage !== undefined ||
  SCALAR_FIELDS.some(
    (name) =>
      !CONFIRMED_FIELDS.some((confirmed) => confirmed === name) &&
      patch[name] !== undefined
  );

const firstSettingMismatch = (
  patch: SettingsPatch,
  settings: typeof Settings.Type
): WriteMismatch | undefined => {
  const field = SCALAR_FIELDS.find(
    (name) => patch[name] !== undefined && settings[name] !== patch[name]
  );

  if (field === undefined) {
    return undefined;
  }

  return new WriteMismatch({
    actual: settings[field],
    expected: patch[field] ?? settings[field],
    field,
  });
};

interface Cell {
  readonly expected: number | undefined;
  readonly field: string;
  readonly value: number;
}

const stageCells = (patch: StagePatch, stage: typeof DpiStage.Type): Cell[] => {
  const slot = `stage${patch.index}`;

  return [
    {
      expected: patch.enable === undefined ? undefined : Number(patch.enable),
      field: `${slot}.enabled`,
      value: Number(stage.enabled),
    },
    { expected: patch.x, field: `${slot}.x`, value: stage.x },
    { expected: patch.y, field: `${slot}.y`, value: stage.y },
    { expected: patch.rgb?.[0], field: `${slot}.r`, value: stage.colour[0] },
    { expected: patch.rgb?.[1], field: `${slot}.g`, value: stage.colour[1] },
    { expected: patch.rgb?.[2], field: `${slot}.b`, value: stage.colour[2] },
  ];
};

const firstStageMismatch = (
  patch: SettingsPatch,
  stages: readonly (typeof DpiStage.Type)[]
): WriteMismatch | undefined => {
  const stage =
    patch.stage === undefined ? undefined : stages[patch.stage.index];

  if (patch.stage === undefined || stage === undefined) {
    return undefined;
  }

  const cell = stageCells(patch.stage, stage).find(
    (c) => c.expected !== undefined && c.expected !== c.value
  );

  return cell?.expected === undefined
    ? undefined
    : new WriteMismatch({
        actual: cell.value,
        expected: cell.expected,
        field: cell.field,
      });
};

const firstBlockMismatch = (
  expected: Uint8Array,
  actual: Uint8Array
): WriteMismatch | undefined => {
  const offset = expected.findIndex((byte, i) => byte !== actual[i]);

  return offset === -1
    ? undefined
    : new WriteMismatch({
        actual: actual[offset] ?? 0,
        expected: expected[offset] ?? 0,
        field: `config byte ${offset}`,
      });
};

const make = Effect.gen(function* makeDevice() {
  const transport = yield* Transport;
  const lock = Semaphore.makeUnsafe(1);
  const store = yield* GateStore;
  const stored = yield* store.load;
  const gate = yield* Ref.make<StoredGate>(stored);

  const gateView = Effect.map(Ref.get(gate), (state): Gate => ({
    backedUp: state.backedUpAt !== null,
    experimental: state.experimental,
  }));

  const commitGate = (next: StoredGate) =>
    Effect.gen(function* commitGateBlock() {
      yield* store.save(next);
      yield* Ref.set(gate, next);
    });

  const send = (frame: Uint8Array, cmd: number) =>
    exchange(frame, cmd).pipe(Effect.provideService(Transport, transport));

  const readConfig = (profile: number) =>
    Effect.gen(function* readConfigBlock() {
      const frames = yield* Effect.fromResult(readConfigFrames(profile));

      const replies = yield* Effect.all(
        frames.map((frame) => send(frame, Command.ReadConfig))
      );

      return yield* Effect.fromResult(
        assembleConfig(replies.map((reply) => reply.data))
      );
    });

  const readProfile = Effect.gen(function* readProfileBlocks() {
    const frame = yield* Effect.fromResult(readActiveProfileFrame());
    const active = yield* send(frame, Command.ReadConfig);
    const profile = yield* Effect.fromResult(decodeActiveProfile(active.data));
    const config = yield* readConfig(profile);
    const displayFrame = yield* Effect.fromResult(readDisplayFrame(profile));
    const display = yield* send(displayFrame, Command.ReadDisplay);

    return { config, display: display.data, profile };
  });

  const ping = Effect.gen(function* pingBlock() {
    const frame = yield* Effect.fromResult(pingFrame());
    const pong = yield* send(frame, Command.Ping);
    const ready = pong.data[0] ?? 0;

    if (ready !== PING_READY) {
      return yield* new NotReady({ ready });
    }
  });

  const readBattery = Effect.gen(function* readBatteryBlock() {
    const frame = yield* Effect.fromResult(readBatteryFrame());
    const reply = yield* send(frame, Command.Battery);

    return yield* Effect.fromResult(decodeBatteryReply(reply.data));
  });

  const read = Effect.gen(function* readDevice() {
    yield* ping;
    const current = yield* readProfile;
    const battery = yield* readBattery;

    const display = yield* Effect.fromResult(
      decodeDisplayBlock(current.display)
    );

    const settings = yield* Effect.fromResult(
      decodeSettingsBlock(current.config)
    );

    const stages = yield* Effect.fromResult(decodeStages(current.config));

    return {
      battery,
      display,
      profile: current.profile,
      settings,
      stages,
    };
  });

  const requireWritable = (experimental: boolean) =>
    Effect.gen(function* requireWritableGate() {
      const state = yield* gateView;

      if (!state.backedUp) {
        return yield* Effect.fail(new BackupRequired());
      }

      if (experimental && !state.experimental) {
        return yield* Effect.fail(new ExperimentalOff());
      }
    });

  const writeSettings = (patch: SettingsPatch) =>
    Effect.gen(function* writeSettingsBlock() {
      yield* requireWritable(touchesExperimental(patch));
      const before = yield* readProfile;

      const { block, frames } = yield* Effect.fromResult(
        writeConfigPatch(before.profile, before.config, patch)
      );

      const sent = yield* Effect.all(
        frames.map((frame) => send(frame, Command.WriteConfig))
      ).pipe(Effect.result);

      const after = yield* readProfile;

      if (Result.isFailure(sent)) {
        return yield* Effect.fail(sent.failure);
      }

      const settings = yield* Effect.fromResult(
        decodeSettingsBlock(after.config)
      );

      const stages = yield* Effect.fromResult(decodeStages(after.config));

      const display = yield* Effect.fromResult(
        decodeDisplayBlock(after.display)
      );

      const mismatch =
        firstSettingMismatch(patch, settings) ??
        firstStageMismatch(patch, stages) ??
        firstBlockMismatch(block, after.config);

      if (mismatch !== undefined) {
        return yield* Effect.fail(mismatch);
      }

      return { display, profile: after.profile, settings, stages };
    }).pipe(lock.withPermits(1));

  const writeDisplay = (patch: DisplayPatch) =>
    Effect.gen(function* writeDisplayBlock() {
      yield* requireWritable(false);
      const before = yield* readProfile;

      const frame = yield* Effect.fromResult(
        writeDisplayFrame(before.profile, before.display, patch)
      );

      yield* send(frame, Command.WriteDisplay);

      const after = yield* readProfile;

      const display = yield* Effect.fromResult(
        decodeDisplayBlock(after.display)
      );

      if (patch.mode !== undefined && display.mode !== patch.mode) {
        return yield* Effect.fail(
          new WriteMismatch({
            actual: display.mode,
            expected: patch.mode,
            field: "mode",
          })
        );
      }

      return display;
    }).pipe(lock.withPermits(1));

  const backup = <E>(save: (input: BackupInput) => Effect.Effect<void, E>) =>
    Effect.gen(function* backupBlock() {
      yield* ping;
      const battery = yield* readBattery;
      const current = yield* readProfile;

      yield* save({
        battery,
        config: current.config,
        display: current.display,
        profile: current.profile,
      });

      const backedUpAt = yield* DateTime.now;
      const state = yield* Ref.get(gate);

      yield* commitGate({ ...state, backedUpAt });
    }).pipe(lock.withPermits(1));

  const notReady = Effect.succeed<LinkStatus>({
    battery: undefined,
    ready: false,
  });

  const status = Effect.gen(function* statusBlock() {
    yield* ping;
    const battery = yield* readBattery;

    return { battery, ready: true } satisfies LinkStatus;
  }).pipe(
    Effect.catchTags({
      NotReady: () => notReady,
      Timeout: () => notReady,
    }),
    lock.withPermits(1)
  );

  return {
    backup,
    gate: gateView,
    read: read.pipe(lock.withPermits(1)),
    setExperimental: (on: boolean) =>
      Effect.gen(function* setExperimentalBlock() {
        const state = yield* Ref.get(gate);

        yield* commitGate({ ...state, experimental: on });
      }),
    status,
    writeDisplay,
    writeSettings,
  } satisfies DeviceApi;
});

export class Device extends Context.Service<Device, DeviceApi>()(
  "device/Device"
) {
  static readonly layer = Layer.effect(Device, make);
}
