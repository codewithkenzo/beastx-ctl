import { Result } from "effect";

import {
  ACTIVE_STAGE,
  CONFIG_CHUNK_STARTS,
  CONFIG_LEN,
  DISPLAY_LEN,
  DPI_STAGES,
  PROFILE_STRIDE,
  configChunkLen,
  profileError,
  stageOffset,
} from "./blocks";
import { FrameLength, OutOfRange } from "./errors";
import type { FrameError } from "./errors";
import { buildFrame, collect, Command } from "./frame";

export const pingFrame = (): Result.Result<Uint8Array, FrameError> =>
  buildFrame(Command.Ping, 0, 0);

export const readActiveProfileFrame = (): Result.Result<
  Uint8Array,
  FrameError
> => buildFrame(Command.ReadConfig, 1, 0);

export const readConfigChunkFrame = (
  profile: number,
  start: number
): Result.Result<Uint8Array, FrameError> => {
  const error = profileError(profile);

  if (error) {
    return Result.fail(error);
  }

  return buildFrame(
    Command.ReadConfig,
    configChunkLen(start),
    profile * PROFILE_STRIDE + start
  );
};

export const readConfigFrames = (
  profile: number
): Result.Result<Uint8Array[], FrameError> =>
  collect(
    CONFIG_CHUNK_STARTS.map((start) => readConfigChunkFrame(profile, start))
  );

export const readDisplayFrame = (
  profile: number
): Result.Result<Uint8Array, FrameError> => {
  const error = profileError(profile);

  if (error) {
    return Result.fail(error);
  }

  return buildFrame(Command.ReadDisplay, DISPLAY_LEN, profile * PROFILE_STRIDE);
};

export const readBatteryFrame = (): Result.Result<Uint8Array, FrameError> =>
  buildFrame(Command.Battery, 6, 0);

export const assembleConfig = (
  chunks: readonly Uint8Array[]
): Result.Result<Uint8Array, FrameError> => {
  const block = new Uint8Array(CONFIG_LEN);

  for (const [index, start] of CONFIG_CHUNK_STARTS.entries()) {
    const chunk = chunks[index];
    const expected = configChunkLen(start);

    if (chunk === undefined || chunk.length !== expected) {
      return Result.fail(
        new FrameLength({ actual: chunk?.length ?? 0, expected })
      );
    }

    block.set(chunk, start);
  }

  return Result.succeed(block);
};

const STAGE_X_OFFSET = 2;

const configChunkStart = (offset: number): number =>
  CONFIG_CHUNK_STARTS.findLast((start) => start <= offset) ?? 0;

const configSlice = (
  chunk: Uint8Array,
  start: number,
  offset: number,
  length: number
): Result.Result<Uint8Array, FrameError> => {
  const expected = configChunkLen(start);

  if (chunk.length !== expected) {
    return Result.fail(new FrameLength({ actual: chunk.length, expected }));
  }

  const from = offset - start;

  if (from < 0 || from + length > expected) {
    return Result.fail(
      new OutOfRange({ field: "offset", max: expected - length, value: from })
    );
  }

  return Result.succeed(chunk.slice(from, from + length));
};

export const activeStageFromChunk = (
  chunk: Uint8Array
): Result.Result<number, FrameError> =>
  Result.map(configSlice(chunk, 0, ACTIVE_STAGE, 1), (bytes) => bytes[0] ?? 0);

const stageXOffset = (stage: number): Result.Result<number, FrameError> => {
  if (!Number.isInteger(stage) || stage < 0 || stage >= DPI_STAGES) {
    return Result.fail(
      new OutOfRange({ field: "stage", max: DPI_STAGES - 1, value: stage })
    );
  }

  return Result.succeed(stageOffset(stage) + STAGE_X_OFFSET);
};

const STAGE_X_BYTES = 2;

export const stageXChunkStart = (
  stage: number
): Result.Result<number, FrameError> =>
  Result.map(stageXOffset(stage), configChunkStart);

export const stageXFromChunk = (
  chunk: Uint8Array,
  start: number,
  stage: number
): Result.Result<number, FrameError> =>
  Result.flatMap(stageXOffset(stage), (offset) =>
    Result.map(configSlice(chunk, start, offset, STAGE_X_BYTES), (bytes) =>
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
        0,
        true
      )
    )
  );
