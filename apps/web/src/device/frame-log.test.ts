import { crc16Modbus } from "@beastx-ctl/protocol";
import { Effect, Layer, Queue } from "effect";
import { describe, expect, it } from "vitest";

import { Device } from "./device";
import {
  appendFrame,
  FRAME_LOG_LIMIT,
  frameConsole,
  framesFile,
  toHex,
} from "./frame-log";
import type { Frame } from "./frame-log";
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

const zeros = (length: number): number[] => Array.from({ length }, () => 0);

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

const harness = (respond: Responder) => {
  const inbox = Effect.runSync(Queue.unbounded<Uint8Array>());

  const transport = Layer.succeed(Transport, {
    clear: Queue.clear(inbox),
    receive: Queue.take(inbox),
    send: (frame: Uint8Array) =>
      Effect.sync(() => {
        for (const reply of respond(frame)) {
          Queue.offerUnsafe(inbox, reply);
        }
      }),
  });

  return Device.layer.pipe(
    Layer.provide(Layer.merge(transport, GateStore.memory()))
  );
};

const cmdOf = (hex: string): string | undefined => hex.split(" ")[3];

const frameAt = (at: number): Frame => ({
  at,
  dir: "rx",
  hex: "04",
  skipped: false,
});

describe("frame log", () => {
  it("formats bytes as spaced lowercase hex", () => {
    expect(toHex(new Uint8Array([4, 0xaa, 0xff]))).toBe("04 aa ff");
  });

  it("names the frame file by ISO date and keeps every frame as JSON", () => {
    const frames = [frameAt(1), frameAt(2)];
    const file = framesFile(frames, new Date("2026-01-02T03:04:05.000Z"));

    expect(file.name).toBe("frames-2026-01-02T03-04-05.000Z.json");
    expect(JSON.parse(file.text)).toStrictEqual(frames);
  });

  it("drops the oldest frame past the limit", () => {
    let ring: readonly Frame[] = [];

    for (let at = 0; at <= FRAME_LOG_LIMIT; at += 1) {
      ring = appendFrame(ring, frameAt(at));
    }

    expect(ring).toHaveLength(FRAME_LOG_LIMIT);
    expect(ring[0]?.at).toBe(1);
    expect(ring.at(-1)?.at).toBe(FRAME_LOG_LIMIT);
  });

  it("keeps nine frames each way for a full read", async () => {
    frameConsole.clearFrames();

    await Effect.runPromise(
      Effect.gen(function* readAll() {
        const api = yield* Device;

        return yield* api.read;
      }).pipe(Effect.provide(harness(healthyRead(settingsBlock()))))
    );

    const frames = frameConsole.frames();
    const sent = frames.filter((frame) => frame.dir === "tx");
    const received = frames.filter((frame) => frame.dir === "rx");

    expect(sent.map((frame) => cmdOf(frame.hex))).toStrictEqual([
      "aa",
      "05",
      "05",
      "05",
      "05",
      "05",
      "05",
      "35",
      "1a",
    ]);
    expect(received).toHaveLength(9);
    expect(received[0]?.hex).toBe(toHex(replyFrame(0xaa, 0, [0xff])));
    expect(received.every((frame) => !frame.skipped)).toBeTruthy();
  });

  it("marks a reply for another command as skipped", async () => {
    frameConsole.clearFrames();

    await Effect.runPromise(
      Effect.gen(function* readAfterStray() {
        const api = yield* Device;

        return yield* api.read;
      }).pipe(
        Effect.provide(
          harness((frame) => [
            replyFrame(0x99, 0, [1]),
            ...healthyRead(settingsBlock())(frame),
          ])
        )
      )
    );

    const received = frameConsole
      .frames()
      .filter((frame) => frame.dir === "rx");

    expect(received[0]?.skipped).toBeTruthy();
    expect(received[0]?.hex).toBe(toHex(replyFrame(0x99, 0, [1])));
    expect(received[1]?.skipped).toBeFalsy();
  });
});
