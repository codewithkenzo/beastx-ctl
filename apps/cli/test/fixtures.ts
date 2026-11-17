import { crc16Modbus } from "@beastx-ctl/protocol";
import { Effect, Option } from "effect";

import type { HidSession } from "../src/hidraw";

const REPORT_ID = 4;
const FRAME_LEN = 64;

const DATA_OFFSET = 8;
const CRC_START = 3;
const CRC_END = 32;
const CONFIG_LEN = 117;
const ACTIVE_STAGE = 12;
const STAGE_BASE = 14;
const STAGE_STRIDE = 9;
const STAGE_X = 2;

export const report = (cmd: number, data: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(FRAME_LEN);
  bytes[0] = REPORT_ID;
  bytes[3] = cmd;
  bytes.set(data, DATA_OFFSET);

  const crc = crc16Modbus(bytes.subarray(CRC_START, CRC_END));
  bytes[1] = crc % 256;
  bytes[2] = Math.floor(crc / 256);

  return bytes;
};

export const foreignReport = (reportId: number): Uint8Array => {
  const bytes = new Uint8Array(FRAME_LEN);
  bytes[0] = reportId;
  bytes.fill(0xde, 1);

  return bytes;
};

export const configMemory = (
  active: number,
  stageX: readonly number[]
): Uint8Array => {
  const memory = new Uint8Array(CONFIG_LEN);
  const view = new DataView(memory.buffer);
  memory[ACTIVE_STAGE] = active;

  for (const [stage, x] of stageX.entries()) {
    view.setUint16(STAGE_BASE + stage * STAGE_STRIDE + STAGE_X, x, true);
  }

  return memory;
};

export const configReply = (
  request: Uint8Array,
  memory: Uint8Array,
  profile: number
): Uint8Array => {
  const view = new DataView(
    request.buffer,
    request.byteOffset,
    request.byteLength
  );

  const cmd = view.getUint8(3);
  const length = view.getUint8(4);
  const address = view.getUint16(5, true);

  if (length === 1 && address === 0) {
    return report(cmd, [profile]);
  }

  return report(cmd, [...memory.subarray(address, address + length)]);
};

export const deviceSession = (
  answer: (frame: Uint8Array) => Uint8Array | undefined,
  foreign: readonly Uint8Array[] = []
) => {
  const queuedForeign = [...foreign];
  const written: Uint8Array[] = [];
  let pending: Uint8Array | undefined;

  const session: HidSession = {
    read: Effect.sync(() => {
      const next = queuedForeign.shift();

      if (next) {
        return Option.some(next);
      }

      const reply = pending;
      pending = undefined;

      return Option.fromNullishOr(reply);
    }),

    write: (frame) =>
      Effect.sync(() => {
        written.push(frame);
        pending = answer(frame);
      }),
  };

  return { session, written };
};
