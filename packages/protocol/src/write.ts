import { Result } from "effect";

import {
  ACTIVE_STAGE,
  CONFIG_CHUNK_STARTS,
  CONFIG_LEN,
  DEBOUNCE,
  DEBOUNCE_MAX,
  DISPLAY_LEN,
  DISPLAY_MODE,
  DPI_MAX,
  DPI_MIN,
  DPI_STAGES,
  DPI_STEP,
  HIGH_MODE,
  LIFT_OFF,
  MOTION_SYNC,
  POLLING_INDEX,
  PROFILE_STRIDE,
  SLEEP,
  configChunkLen,
  profileError,
  stageOffset,
} from "./blocks";
import { FrameLength, OutOfRange, UnsupportedValue } from "./errors";
import type { FrameError } from "./errors";
import { buildFrame, collect, Command, isInRange } from "./frame";

type Rgb = readonly [number, number, number];

export interface StagePatch {
  readonly enable?: boolean;
  readonly index: number;
  readonly rgb?: Rgb;
  readonly x?: number;
  readonly y?: number;
}

export interface SettingsPatch {
  readonly activeStage?: number;
  readonly debounceMs?: number;
  readonly liftOff?: number;
  readonly motionSync?: number;
  readonly pollingIndex?: number;
  readonly sleepSeconds?: number;
  readonly stage?: StagePatch;
}

export interface DisplayPatch {
  readonly mode?: number;
}

const SETTING_LIMITS = {
  activeStage: 7,
  debounceMs: DEBOUNCE_MAX,
  liftOff: 1,
  motionSync: 1,
  pollingIndex: 5,
} as const;

const SLEEP_SECONDS: ReadonlySet<number> = new Set([30, 60, 300]);

const HIGH_MODE_MAX_POLLING = 3;

const rangeError = (
  field: string,
  value: number | undefined,
  max: number
): OutOfRange | undefined =>
  value === undefined || isInRange(value, max)
    ? undefined
    : new OutOfRange({ field, max, value });

const sleepError = (value: number | undefined): UnsupportedValue | undefined =>
  value === undefined || SLEEP_SECONDS.has(value)
    ? undefined
    : new UnsupportedValue({ field: "sleepSeconds", value });

const firstSettingError = (patch: SettingsPatch): FrameError | undefined => {
  for (const field of Object.keys(
    SETTING_LIMITS
  ) as (keyof typeof SETTING_LIMITS)[]) {
    const error = rangeError(field, patch[field], SETTING_LIMITS[field]);

    if (error) {
      return error;
    }
  }

  return sleepError(patch.sleepSeconds);
};

const stageIndexError = (index: number): OutOfRange | undefined =>
  isInRange(index, DPI_STAGES - 1)
    ? undefined
    : new OutOfRange({
        field: "stage.index",
        max: DPI_STAGES - 1,
        value: index,
      });

const dpiError = (
  field: string,
  dpi: number | undefined
): UnsupportedValue | undefined =>
  dpi === undefined ||
  (Number.isInteger(dpi) &&
    dpi >= DPI_MIN &&
    dpi <= DPI_MAX &&
    dpi % DPI_STEP === 0)
    ? undefined
    : new UnsupportedValue({ field, value: dpi });

const colourError = (
  slot: number,
  rgb: Rgb | undefined
): OutOfRange | undefined => {
  const channel = rgb?.find((value) => !isInRange(value, 0xff));

  return channel === undefined
    ? undefined
    : new OutOfRange({
        field: `stage${slot}.colour`,
        max: 0xff,
        value: channel,
      });
};

const stageError = (stage: StagePatch | undefined): FrameError | undefined => {
  if (stage === undefined) {
    return undefined;
  }

  return (
    stageIndexError(stage.index) ??
    dpiError(`stage${stage.index}.x`, stage.x) ??
    dpiError(`stage${stage.index}.y`, stage.y) ??
    colourError(stage.index, stage.rgb)
  );
};

const isEnabled = (data: Uint8Array, slot: number): boolean =>
  data[stageOffset(slot)] === 1;

const enabledCount = (data: Uint8Array): number =>
  Array.from({ length: DPI_STAGES }, (_unused, slot) =>
    isEnabled(data, slot)
  ).filter(Boolean).length;

const activeStageError = (
  activeStage: number | undefined,
  patched: Uint8Array
): UnsupportedValue | undefined =>
  activeStage === undefined || isEnabled(patched, activeStage)
    ? undefined
    : new UnsupportedValue({ field: "activeStage", value: activeStage });

const stageToggleError = (
  stage: StagePatch | undefined,
  patched: Uint8Array
): UnsupportedValue | undefined => {
  if (stage === undefined || stage.enable !== false) {
    return undefined;
  }

  if (patched[ACTIVE_STAGE] === stage.index) {
    return new UnsupportedValue({
      field: "stage.enable (active stage)",
      value: stage.index,
    });
  }

  return enabledCount(patched) === 0
    ? new UnsupportedValue({
        field: "stage.enable (last stage)",
        value: stage.index,
      })
    : undefined;
};

const setByte = (
  data: Uint8Array,
  offset: number,
  value: number | undefined
): void => {
  if (value !== undefined) {
    data[offset] = value;
  }
};

const applyStage = (data: Uint8Array, stage: StagePatch): void => {
  const at = stageOffset(stage.index);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (stage.enable !== undefined) {
    data[at] = stage.enable ? 1 : 0;
  }

  if (stage.x !== undefined) {
    view.setUint16(at + 2, stage.x, true);
  }

  if (stage.y !== undefined) {
    view.setUint16(at + 4, stage.y, true);
  }

  if (stage.rgb !== undefined) {
    data.set(stage.rgb, at + 6);
  }
};

const applySettingsPatch = (data: Uint8Array, patch: SettingsPatch): void => {
  setByte(data, POLLING_INDEX, patch.pollingIndex);
  setByte(data, LIFT_OFF, patch.liftOff);
  setByte(data, ACTIVE_STAGE, patch.activeStage);
  setByte(data, DEBOUNCE, patch.debounceMs);
  setByte(data, MOTION_SYNC, patch.motionSync);

  if (
    patch.pollingIndex !== undefined &&
    patch.pollingIndex > HIGH_MODE_MAX_POLLING
  ) {
    data[HIGH_MODE] = 0;
  }

  if (patch.sleepSeconds !== undefined) {
    new DataView(data.buffer).setUint16(SLEEP, patch.sleepSeconds, true);
  }

  if (patch.stage !== undefined) {
    applyStage(data, patch.stage);
  }
};

const chunkChanged = (
  before: Uint8Array,
  after: Uint8Array,
  start: number
): boolean => {
  for (let i = start; i < start + configChunkLen(start); i += 1) {
    if (before[i] !== after[i]) {
      return true;
    }
  }

  return false;
};

export interface ConfigPatch {
  readonly block: Uint8Array;
  readonly frames: Uint8Array[];
}

export const writeConfigPatch = (
  profile: number,
  block: Uint8Array,
  patch: SettingsPatch
): Result.Result<ConfigPatch, FrameError> => {
  if (block.length !== CONFIG_LEN) {
    return Result.fail(
      new FrameLength({ actual: block.length, expected: CONFIG_LEN })
    );
  }

  const error =
    profileError(profile) ??
    firstSettingError(patch) ??
    stageError(patch.stage);

  if (error) {
    return Result.fail(error);
  }

  const patched = Uint8Array.from(block);
  applySettingsPatch(patched, patch);

  const stateError =
    activeStageError(patch.activeStage, patched) ??
    stageToggleError(patch.stage, patched);

  if (stateError) {
    return Result.fail(stateError);
  }

  return Result.map(
    collect(
      CONFIG_CHUNK_STARTS.filter((start) =>
        chunkChanged(block, patched, start)
      ).map((start) =>
        buildFrame(
          Command.WriteConfig,
          configChunkLen(start),
          profile * PROFILE_STRIDE + start,
          patched.subarray(start, start + configChunkLen(start))
        )
      )
    ),
    (frames) => ({ block: patched, frames })
  );
};

export const writeDisplayFrame = (
  profile: number,
  current: Uint8Array,
  patch: DisplayPatch
): Result.Result<Uint8Array, FrameError> => {
  if (current.length !== DISPLAY_LEN) {
    return Result.fail(
      new FrameLength({ actual: current.length, expected: DISPLAY_LEN })
    );
  }

  const error = profileError(profile) ?? rangeError("mode", patch.mode, 1);

  if (error) {
    return Result.fail(error);
  }

  const data = Uint8Array.from(current);

  if (patch.mode !== undefined) {
    data[DISPLAY_MODE] = patch.mode;
  }

  return buildFrame(
    Command.WriteDisplay,
    DISPLAY_LEN,
    profile * PROFILE_STRIDE,
    data
  );
};
