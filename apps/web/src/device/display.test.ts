import { crc16Modbus } from "@beastx-ctl/protocol";
import { Effect, Layer, Queue, Result } from "effect";
import { describe, expect, it } from "vitest";

import { BackupDownloadError } from "./backup";
import { Device } from "./device";
import { displayModes, displayPatchFor } from "./display";
import { BackupRequired, WriteMismatch } from "./errors";
import { GateStore } from "./gate-store";
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

const harness = (respond: Responder) => {
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

  return {
    layer: Device.layer.pipe(
      Layer.provide(Layer.merge(layer, GateStore.memory()))
    ),
    sent,
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

const healthy =
  (block: Uint8Array, display: Uint8Array): Responder =>
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
      return [
        replyFrame(0x35, address, [
          ...display.subarray(address, address + chunkLen),
        ]),
      ];
    }

    return [];
  };

const failureOf = <E>(outcome: Result.Result<unknown, E>): E | undefined =>
  Result.isFailure(outcome) ? outcome.failure : undefined;

describe(displayPatchFor, () => {
  it("maps Default and Custom onto mode 0 and 1", () => {
    expect(displayPatchFor("0")).toStrictEqual({ mode: 0 });
    expect(displayPatchFor("1")).toStrictEqual({ mode: 1 });
  });

  it("sends nothing for a value outside the screen modes", () => {
    expect(displayPatchFor("2")).toBeUndefined();
    expect(displayPatchFor("")).toBeUndefined();
    expect(displayPatchFor("custom")).toBeUndefined();
  });

  it("offers only the two modes the protocol decodes", () => {
    expect(displayModes.map(({ mode }) => mode)).toStrictEqual([0, 1]);
  });
});

describe("display write", () => {
  it("refuses before the backup and sends nothing", async () => {
    const display = new Uint8Array(13);
    const device = harness(healthy(settingsBlock(), display));

    const outcome = await Effect.runPromise(
      Effect.gen(function* writeBeforeBackup() {
        const api = yield* Device;

        return yield* api.writeDisplay({ mode: 1 }).pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(BackupRequired);
    expect(device.sent.some((frame) => field(frame, 3) === 0x36)).toBeFalsy();
  });

  it("refuses a write when the backup file was not saved", async () => {
    const display = new Uint8Array(13);
    const device = harness(healthy(settingsBlock(), display));

    const outcome = await Effect.runPromise(
      Effect.gen(function* writeBeforeSave() {
        const api = yield* Device;

        yield* api
          .backup(() =>
            Effect.fail(new BackupDownloadError({ message: "blocked" }))
          )
          .pipe(Effect.result);

        return yield* api.writeDisplay({ mode: 1 }).pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(BackupRequired);
    expect(device.sent.some((frame) => field(frame, 3) === 0x36)).toBeFalsy();
  });

  it("writes the mode after backup and reads it back", async () => {
    const block = settingsBlock();
    const display = new Uint8Array(13);
    const base = healthy(block, display);

    const device = harness((frame) => {
      if (field(frame, 3) === 0x36) {
        const address = addressOf(frame);
        display.set(frame.subarray(8, 8 + field(frame, 4)), address);

        return [replyFrame(0x36, address, [])];
      }

      return base(frame);
    });

    const outcome = await Effect.runPromise(
      Effect.gen(function* writeAfterBackup() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);

        return yield* api.writeDisplay({ mode: 1 }).pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(Result.isSuccess(outcome)).toBeTruthy();
    expect(Result.getOrThrow(outcome)).toStrictEqual({ mode: 1 });
    expect(display[6]).toBe(1);
    expect(device.sent.some((frame) => field(frame, 3) === 0x36)).toBeTruthy();
  });

  it("reports a mode mismatch when the device does not apply the write", async () => {
    const block = settingsBlock();
    const display = new Uint8Array(13);
    const base = healthy(block, display);

    const device = harness((frame) =>
      field(frame, 3) === 0x36
        ? [replyFrame(0x36, addressOf(frame), [])]
        : base(frame)
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* readBackMismatch() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);

        return yield* api.writeDisplay({ mode: 1 }).pipe(Effect.result);
      }).pipe(Effect.provide(device.layer))
    );

    expect(failureOf(outcome)).toBeInstanceOf(WriteMismatch);
    expect(failureOf(outcome)).toMatchObject({ expected: 1, field: "mode" });
  });
});
