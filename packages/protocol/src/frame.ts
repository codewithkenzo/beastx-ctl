import { Result } from "effect";

import { crc16Modbus } from "./crc";
import { FrameLength, OutOfRange, UnsupportedCommand } from "./errors";
import type { FrameError } from "./errors";

export const FRAME_LEN = 64;
export const REPORT_ID = 0x04;
export const CRC_START = 3;
export const CRC_END = 32;
const MAX_CHUNK = 0x18;
export const DATA_OFFSET = 8;
const MAX_ADDRESS = 0xff_ff;

export const Command = {
  Battery: 0x1a,
  Begin: 0x01,
  End: 0x02,
  Ping: 0xaa,
  ReadConfig: 0x05,
  ReadDisplay: 0x35,
  WriteConfig: 0x06,
  WriteDisplay: 0x36,
} as const;

const ALLOWED: ReadonlySet<number> = new Set<number>(Object.values(Command));

const READ_ONLY: ReadonlySet<number> = new Set<number>([
  Command.Battery,
  Command.Ping,
  Command.ReadConfig,
  Command.ReadDisplay,
]);

export const isInRange = (value: number, max: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= max;

export const collect = <A, E>(
  results: readonly Result.Result<A, E>[]
): Result.Result<A[], E> => {
  const values: A[] = [];

  for (const result of results) {
    if (Result.isFailure(result)) {
      return Result.fail(result.failure);
    }

    values.push(result.success);
  }

  return Result.succeed(values);
};

export const buildFrame = (
  cmd: number,
  chunkLen: number,
  address: number,
  data: Uint8Array = new Uint8Array(0)
): Result.Result<Uint8Array, FrameError> => {
  if (!ALLOWED.has(cmd)) {
    return Result.fail(new UnsupportedCommand({ cmd }));
  }

  if (READ_ONLY.has(cmd) && data.length !== 0) {
    return Result.fail(new UnsupportedCommand({ cmd }));
  }

  if (!isInRange(chunkLen, MAX_CHUNK)) {
    return Result.fail(
      new OutOfRange({ field: "chunkLen", max: MAX_CHUNK, value: chunkLen })
    );
  }

  if (!isInRange(address, MAX_ADDRESS)) {
    return Result.fail(
      new OutOfRange({ field: "address", max: MAX_ADDRESS, value: address })
    );
  }

  if (data.length !== 0 && data.length !== chunkLen) {
    return Result.fail(
      new FrameLength({ actual: data.length, expected: chunkLen })
    );
  }

  const frame = new Uint8Array(FRAME_LEN);
  frame[0] = REPORT_ID;
  frame[3] = cmd;
  frame[4] = chunkLen;
  frame[5] = address % 256;
  frame[6] = Math.floor(address / 256);
  frame.set(data, DATA_OFFSET);

  const crc = crc16Modbus(frame.subarray(CRC_START, CRC_END));
  frame[1] = crc % 256;
  frame[2] = Math.floor(crc / 256);

  return Result.succeed(frame);
};
