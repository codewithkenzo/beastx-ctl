import { crc16Modbus } from "@beastx-ctl/protocol";
import { DateTime, Effect, Layer, Queue, Ref, Result } from "effect";
import { describe, expect, it } from "vitest";

import { BackupDownloadError } from "./backup";
import { Device } from "./device";
import {
  BackupRequired,
  ExperimentalOff,
  RetriesExhausted,
  Timeout,
  WriteMismatch,
} from "./errors";
import { MAX_RESENDS } from "./exchange";
import { CLOSED_STORED, GateStore, GateStoreError } from "./gate-store";
import type { StoredGate } from "./gate-store";
import { Transport } from "./transport";

type Responder = (frame: Uint8Array) => readonly Uint8Array[];

const field = (frame: Uint8Array, index: number): number => frame[index] ?? 0;

const addressOf = (frame: Uint8Array): number =>
  new DataView(frame.buffer, frame.byteOffset).getUint16(5, true);

const replyFrame = (
  cmd: number,
  address: number,
  data: readonly number[]
): Uint8Array => {
  const frame = new Uint8Array(64);
  frame[0] = 0x04;
  frame[3] = cmd;
  frame[4] = data.length;

  new DataView(frame.buffer).setUint16(5, address, true);
  frame.set(data, 8);

  const crc = crc16Modbus(frame.subarray(3, 32));
  frame[1] = crc % 256;
  frame[2] = Math.floor(crc / 256);

  return frame;
};

const zeros = (length: number): number[] => Array.from({ length }, () => 0);

const fakeTransport = (respond: Responder) => {
  const inbox = Effect.runSync(Queue.unbounded<Uint8Array>());
  const sent: Uint8Array[] = [];

  const layer = Layer.succeed(Transport, {
    clear: Queue.clear(inbox),
    receive: Queue.take(inbox),
    send: (frame: Uint8Array) =>
      Effect.sync(() => {
        sent.push(frame);

        for (const reply of respond(frame)) {
          Queue.offerUnsafe(inbox, reply);
        }
      }),
  });

  return { layer, sent };
};

const harness = (respond: Responder) => {
  const transport = fakeTransport(respond);

  return {
    layer: Device.layer.pipe(
      Layer.provide(Layer.merge(transport.layer, GateStore.memory()))
    ),
    sent: transport.sent,
  };
};

const sharedStore = (initial: StoredGate) => {
  const cell = Ref.makeUnsafe(initial);

  return {
    layer: Layer.succeed(GateStore, {
      load: Ref.get(cell),
      save: (gate: StoredGate) => Ref.set(cell, gate),
    }),
    load: Ref.get(cell),
  };
};

const settingsBlock = (): Uint8Array => {
  const block = new Uint8Array(117);
  block[11] = 3;
  block[14] = 1;
  block[16] = 0x40;
  block[17] = 0x06;
  block[18] = 0x40;
  block[19] = 0x06;
  block[20] = 0x10;
  block[22] = 0xc8;
  block[86] = 0x3c;
  block[90] = 4;
  block[92] = 1;

  return block;
};

const healthyRead =
  (block: Uint8Array): Responder =>
  (frame) => {
    const cmd = field(frame, 3);
    const address = addressOf(frame);
    const chunkLen = field(frame, 4);

    if (cmd === 0xaa) {
      return [replyFrame(0xaa, 0, [0xff])];
    }

    if (cmd === 0x1a) {
      return [replyFrame(0x1a, 0, [72, 0, 0, 0, 0, 0])];
    }

    if (cmd === 0x05 && chunkLen === 1) {
      return [replyFrame(0x05, 0, [0])];
    }

    if (cmd === 0x05) {
      return [
        replyFrame(0x05, address, [
          ...block.subarray(address, address + chunkLen),
        ]),
      ];
    }

    if (cmd === 0x35) {
      return [replyFrame(0x35, address, zeros(13))];
    }

    return [];
  };

const failureOf = <E>(outcome: Result.Result<unknown, E>): E | undefined =>
  Result.isFailure(outcome) ? outcome.failure : undefined;

describe("device read", () => {
  it("reads profile, settings, stages, display and battery", async () => {
    const device = harness(healthyRead(settingsBlock()));

    const read = await Effect.runPromise(
      Effect.gen(function* readAll() {
        const api = yield* Device;

        return yield* api.read;
      }).pipe(Effect.provide(device.layer))
    );

    expect(read.profile).toBe(0);
    expect(read.settings.pollingIndex).toBe(3);
    expect(read.settings.sleepSeconds).toBe(60);
    expect(read.stages[0]).toStrictEqual({
      colour: [0x10, 0x00, 0xc8],
      enabled: true,
      x: 1600,
      y: 1600,
    });
    expect(read.battery).toStrictEqual({ charging: false, percent: 72 });
  });

  it("skips a reply whose command is not the one asked for", async () => {
    const base = healthyRead(settingsBlock());
    let strayed = false;

    const device = harness((frame) => {
      if (field(frame, 3) === 0x05 && field(frame, 4) === 1 && !strayed) {
        strayed = true;

        return [replyFrame(0x35, 0, zeros(13)), ...base(frame)];
      }

      return base(frame);
    });

    const read = await Effect.runPromise(
      Effect.gen(function* readAfterStray() {
        const api = yield* Device;

        return yield* api.read;
      }).pipe(Effect.provide(device.layer))
    );

    expect(read.profile).toBe(0);
  });

  it("fails with Timeout when the device stays silent", async () => {
    const device = harness(() => []);

    const outcome = await Effect.runPromise(
      Effect.gen(function* readSilent() {
        const api = yield* Device;

        return yield* api.read.pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(Timeout);
  });
});

describe("write gates", () => {
  it("refuses a confirmed-field write before the backup", async () => {
    const device = harness(healthyRead(settingsBlock()));

    const outcome = await Effect.runPromise(
      Effect.gen(function* writeBeforeBackup() {
        const api = yield* Device;

        return yield* api
          .writeSettings({ pollingIndex: 2 })
          .pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(BackupRequired);
  });

  it("refuses an experimental field without the switch", async () => {
    const device = harness(healthyRead(settingsBlock()));

    const outcome = await Effect.runPromise(
      Effect.gen(function* experimentalOff() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);

        return yield* api
          .writeSettings({ sleepSeconds: 30 })
          .pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(ExperimentalOff);
  });

  it("writes a confirmed field after backup without the switch, then reads it back", async () => {
    const block = settingsBlock();
    const base = healthyRead(block);

    const device = harness((frame) => {
      if (field(frame, 3) === 0x06) {
        const address = addressOf(frame);
        block.set(frame.subarray(8, 8 + field(frame, 4)), address);

        return [replyFrame(0x06, address, [])];
      }

      return base(frame);
    });

    const written = await Effect.runPromise(
      Effect.gen(function* writeConfirmed() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);

        return yield* api.writeSettings({ pollingIndex: 2 });
      }).pipe(Effect.provide(device.layer))
    );

    expect(block[11]).toBe(2);
    expect(written.settings.pollingIndex).toBe(2);
    expect(device.sent.some((frame) => field(frame, 3) === 0x06)).toBeTruthy();
  });

  it("reports a read-back mismatch when the device does not apply the write", async () => {
    const base = healthyRead(settingsBlock());

    const device = harness((frame) =>
      field(frame, 3) === 0x06
        ? [replyFrame(0x06, addressOf(frame), [])]
        : base(frame)
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* readBackMismatch() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);
        yield* api.setExperimental(true);

        return yield* api
          .writeSettings({ sleepSeconds: 30 })
          .pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(WriteMismatch);
  });

  it("flags a neighbour byte the write did not patch, by its offset", async () => {
    const block = settingsBlock();
    const base = healthyRead(block);

    const device = harness((frame) => {
      if (field(frame, 3) !== 0x06) {
        return base(frame);
      }

      const address = addressOf(frame);
      block.set(frame.subarray(8, 8 + field(frame, 4)), address);
      block[88] = 0x77;

      return [replyFrame(0x06, address, [])];
    });

    const outcome = await Effect.runPromise(
      Effect.gen(function* neighbourByte() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);
        yield* api.setExperimental(true);

        return yield* api
          .writeSettings({ sleepSeconds: 30 })
          .pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toMatchObject({
      _tag: "WriteMismatch",
      actual: 0x77,
      expected: 0,
      field: "config byte 88",
    });
  });

  it("reads back after a multi-chunk write fails partway", async () => {
    const block = settingsBlock();
    const base = healthyRead(block);

    const device = harness((frame) => {
      if (field(frame, 3) !== 0x06) {
        return base(frame);
      }

      const address = addressOf(frame);

      if (address !== 0) {
        return [];
      }

      block.set(frame.subarray(8, 8 + field(frame, 4)), address);

      return [replyFrame(0x06, address, [])];
    });

    const outcome = await Effect.runPromise(
      Effect.gen(function* partialWrite() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);
        yield* api.setExperimental(true);

        return yield* api
          .writeSettings({ pollingIndex: 2, sleepSeconds: 30 })
          .pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    const lastWrite = device.sent.findLastIndex(
      (frame) => field(frame, 3) === 0x06
    );

    expect(block[11]).toBe(2);
    expect(
      device.sent.slice(lastWrite + 1).some((frame) => field(frame, 3) === 0x05)
    ).toBeTruthy();
    expect(failureOf(outcome)).toBeInstanceOf(Timeout);
  });
});

const stageZeroX = (x: number) => ({ stage: { index: 0, x } });

describe("stage writes", () => {
  it("refuses a stage write without the experimental switch", async () => {
    const device = harness(healthyRead(settingsBlock()));

    const outcome = await Effect.runPromise(
      Effect.gen(function* stageWriteOff() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);

        return yield* api.writeSettings(stageZeroX(1200)).pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(ExperimentalOff);
  });

  it("writes a stage edit after the switch and reads it back", async () => {
    const block = settingsBlock();
    const base = healthyRead(block);

    const device = harness((frame) => {
      if (field(frame, 3) === 0x06) {
        const address = addressOf(frame);
        block.set(frame.subarray(8, 8 + field(frame, 4)), address);

        return [replyFrame(0x06, address, [])];
      }

      return base(frame);
    });

    const outcome = await Effect.runPromise(
      Effect.gen(function* stageWriteOn() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);
        yield* api.setExperimental(true);

        return yield* api.writeSettings(stageZeroX(1200)).pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(Result.isSuccess(outcome)).toBeTruthy();
    expect(block[14]).toBe(1);
    expect(block[16]).toBe(0xb0);
    expect(block[17]).toBe(0x04);
  });

  it("reports the stage cell that did not read back", async () => {
    const base = healthyRead(settingsBlock());

    const device = harness((frame) =>
      field(frame, 3) === 0x06
        ? [replyFrame(0x06, addressOf(frame), [])]
        : base(frame)
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* stageReadBack() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);
        yield* api.setExperimental(true);

        return yield* api.writeSettings(stageZeroX(1200)).pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(WriteMismatch);
    expect(failureOf(outcome)).toMatchObject({
      actual: 1600,
      expected: 1200,
      field: "stage0.x",
    });
  });
});

describe("status and gate", () => {
  it("reports ready with the battery after ping and battery reads", async () => {
    const device = harness(healthyRead(settingsBlock()));

    const status = await Effect.runPromise(
      Effect.gen(function* readStatus() {
        const api = yield* Device;

        return yield* api.status;
      }).pipe(Effect.provide(device.layer))
    );

    expect(status).toStrictEqual({
      battery: { charging: false, percent: 72 },
      ready: true,
    });
  });

  it("reports not ready when the ping reply is not ready", async () => {
    const device = harness((frame) =>
      field(frame, 3) === 0xaa ? [replyFrame(0xaa, 0, [0x00])] : []
    );

    const status = await Effect.runPromise(
      Effect.gen(function* readNotReadyStatus() {
        const api = yield* Device;

        return yield* api.status;
      }).pipe(Effect.provide(device.layer))
    );

    expect(status).toStrictEqual({ battery: undefined, ready: false });
  });

  it("reports not ready when the device stays silent", async () => {
    const device = harness(() => []);

    const status = await Effect.runPromise(
      Effect.gen(function* readSilentStatus() {
        const api = yield* Device;

        return yield* api.status;
      }).pipe(Effect.provide(device.layer))
    );

    expect(status).toStrictEqual({ battery: undefined, ready: false });
  });

  it("opens the gate only after the backup is saved", async () => {
    const device = harness(healthyRead(settingsBlock()));

    const gates = await Effect.runPromise(
      Effect.gen(function* gateSteps() {
        const api = yield* Device;
        const before = yield* api.gate;
        yield* api.backup(() => Effect.void);
        const after = yield* api.gate;

        return { after, before };
      }).pipe(Effect.provide(device.layer))
    );

    expect(gates).toStrictEqual({
      after: { backedUp: true, experimental: false },
      before: { backedUp: false, experimental: false },
    });
  });

  it("keeps the gate shut when the backup file cannot be saved", async () => {
    const device = harness(healthyRead(settingsBlock()));

    const outcome = await Effect.runPromise(
      Effect.gen(function* failedSave() {
        const api = yield* Device;

        const saved = yield* api
          .backup(() =>
            Effect.fail(new BackupDownloadError({ message: "blocked" }))
          )
          .pipe(Effect.result);

        return { gate: yield* api.gate, saved };
      }).pipe(Effect.provide(device.layer))
    );

    expect(outcome.gate).toStrictEqual({
      backedUp: false,
      experimental: false,
    });
    expect(failureOf(outcome.saved)).toBeInstanceOf(BackupDownloadError);
  });

  it("opens writes at startup from a stored backup", async () => {
    const block = settingsBlock();
    const base = healthyRead(block);

    const store = sharedStore({
      backedUpAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
      experimental: false,
    });

    const device = Device.layer.pipe(
      Layer.provide(
        Layer.merge(
          fakeTransport((frame) => {
            if (field(frame, 3) === 0x06) {
              const address = addressOf(frame);
              block.set(frame.subarray(8, 8 + field(frame, 4)), address);

              return [replyFrame(0x06, address, [])];
            }

            return base(frame);
          }).layer,
          store.layer
        )
      )
    );

    const written = await Effect.runPromise(
      Effect.gen(function* writeStored() {
        const api = yield* Device;

        return yield* api.writeSettings({ pollingIndex: 2 });
      }).pipe(Effect.provide(device))
    );

    expect(block[11]).toBe(2);
    expect(written.settings.pollingIndex).toBe(2);
  });

  it("stores the backup time when the backup is saved", async () => {
    const store = sharedStore(CLOSED_STORED);

    const device = Device.layer.pipe(
      Layer.provide(
        Layer.merge(
          fakeTransport(healthyRead(settingsBlock())).layer,
          store.layer
        )
      )
    );

    await Effect.runPromise(
      Effect.gen(function* backupStored() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);
      }).pipe(Effect.provide(device))
    );

    const saved = await Effect.runPromise(store.load);

    expect(saved.backedUpAt).not.toBeNull();
  });

  it("stores the experimental switch when it is toggled", async () => {
    const store = sharedStore(CLOSED_STORED);

    const device = Device.layer.pipe(
      Layer.provide(
        Layer.merge(
          fakeTransport(healthyRead(settingsBlock())).layer,
          store.layer
        )
      )
    );

    await Effect.runPromise(
      Effect.gen(function* toggleStored() {
        const api = yield* Device;
        yield* api.setExperimental(true);
      }).pipe(Effect.provide(device))
    );

    const saved = await Effect.runPromise(store.load);

    expect(saved.experimental).toBeTruthy();
  });

  it("keeps the gate shut when the store cannot save the backup", async () => {
    const device = Device.layer.pipe(
      Layer.provide(
        Layer.merge(
          fakeTransport(healthyRead(settingsBlock())).layer,
          Layer.succeed(GateStore, {
            load: Effect.succeed(CLOSED_STORED),
            save: () => Effect.fail(new GateStoreError({ message: "full" })),
          })
        )
      )
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* unsavedBackup() {
        const api = yield* Device;

        const saved = yield* api.backup(() => Effect.void).pipe(Effect.result);

        return { gate: yield* api.gate, saved };
      }).pipe(Effect.provide(device))
    );

    expect(outcome.gate).toStrictEqual({
      backedUp: false,
      experimental: false,
    });
    expect(failureOf(outcome.saved)).toBeInstanceOf(GateStoreError);
  });

  it("neither saves nor opens the gate when the profile read fails", async () => {
    const device = harness(() => []);
    const saves: string[] = [];

    const outcome = await Effect.runPromise(
      Effect.gen(function* failedRead() {
        const api = yield* Device;

        const saved = yield* api
          .backup(() => {
            saves.push("save");

            return Effect.void;
          })
          .pipe(Effect.result);

        return { gate: yield* api.gate, saved };
      }).pipe(Effect.provide(device.layer))
    );

    expect(saves).toStrictEqual([]);
    expect(outcome.gate).toStrictEqual({
      backedUp: false,
      experimental: false,
    });
    expect(failureOf(outcome.saved)).toBeInstanceOf(Timeout);
  });
});

describe("retry marker", () => {
  it("resends the same active-profile frame after a 0x50 reply", async () => {
    const base = healthyRead(settingsBlock());
    let markers = 0;

    const device = harness((frame) => {
      if (field(frame, 3) === 0x05 && field(frame, 4) === 1 && markers < 1) {
        markers += 1;

        return [replyFrame(0x50, 0, [])];
      }

      return base(frame);
    });

    const read = await Effect.runPromise(
      Effect.gen(function* resendOnMarker() {
        const api = yield* Device;

        return yield* api.read;
      }).pipe(Effect.provide(device.layer))
    );

    const activeReads = device.sent.filter(
      (frame) => field(frame, 3) === 0x05 && field(frame, 4) === 1
    );

    expect(read.profile).toBe(0);
    expect(activeReads).toHaveLength(2);
    expect(activeReads[1]).toStrictEqual(activeReads[0]);
  });

  it("fails with RetriesExhausted once the resend budget is spent", async () => {
    const base = healthyRead(settingsBlock());

    const device = harness((frame) =>
      field(frame, 3) === 0x05 && field(frame, 4) === 1
        ? [replyFrame(0x50, 0, [])]
        : base(frame)
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* readMarkedOut() {
        const api = yield* Device;

        return yield* api.read.pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    const activeReads = device.sent.filter(
      (frame) => field(frame, 3) === 0x05 && field(frame, 4) === 1
    );

    expect(failureOf(outcome)).toBeInstanceOf(RetriesExhausted);
    expect(activeReads).toHaveLength(MAX_RESENDS + 1);
  });
});
