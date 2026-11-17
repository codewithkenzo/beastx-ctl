import { Result, Schema } from "effect";

import { FrameLength, OutOfRange } from "./errors";
import type { FrameError } from "./errors";

export const CONFIG_LEN = 117;
const CONFIG_CHUNK = 24;
export const CONFIG_CHUNK_STARTS = [0, 24, 48, 72, 96];
export const PROFILE_STRIDE = 0x80;
const PROFILE_MAX = 0;

export const configChunkLen = (start: number): number =>
  Math.min(CONFIG_CHUNK, CONFIG_LEN - start);

export const profileError = (profile: number): OutOfRange | undefined =>
  Number.isInteger(profile) && profile >= 0 && profile <= PROFILE_MAX
    ? undefined
    : new OutOfRange({ field: "profile", max: PROFILE_MAX, value: profile });

export const DISPLAY_LEN = 13;
export const STAGE_COUNT = 9;
export const HIGH_MODE = 10;
export const ACTIVE_STAGE = 12;
export const POLLING_INDEX = 11;
export const LIFT_OFF = 13;
export const SLEEP = 86;
export const DEBOUNCE = 90;
export const DEBOUNCE_MAX = 12;
export const MOTION_SYNC = 92;
export const DISPLAY_MODE = 6;

export const DPI_STAGES = 8;
export const DPI_MIN = 50;
export const DPI_MAX = 26_000;
export const DPI_STEP = 50;
const STAGE_BASE = 14;
const STAGE_STRIDE = 9;

export const stageOffset = (slot: number): number =>
  STAGE_BASE + slot * STAGE_STRIDE;

export const ConfigBlock = Schema.Struct({
  liftOff: Schema.Int.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
  pollingIndex: Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 0 })),
});

export const DisplayBlock = Schema.Struct({
  mode: Schema.Int.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
});

export const Settings = Schema.Struct({
  activeStage: Schema.Int.check(Schema.isBetween({ maximum: 7, minimum: 0 })),
  debounceMs: Schema.Int.check(
    Schema.isBetween({ maximum: DEBOUNCE_MAX, minimum: 0 })
  ),
  liftOff: Schema.Int.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
  motionSync: Schema.Int.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
  pollingIndex: Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 0 })),
  sleepSeconds: Schema.Int.check(
    Schema.isBetween({ maximum: 0xff_ff, minimum: 0 })
  ),
});

export const Battery = Schema.Struct({
  charging: Schema.Boolean,
  percent: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 0 })),
});

export const decodeActiveProfile = (
  data: Uint8Array
): Result.Result<number, FrameError> => {
  if (data.length < 1) {
    return Result.fail(new FrameLength({ actual: data.length, expected: 1 }));
  }

  const profile = data[0] ?? 0;
  const error = profileError(profile);

  return error ? Result.fail(error) : Result.succeed(profile);
};

export const decodeConfigBlock = (
  bytes: Uint8Array
): Result.Result<typeof ConfigBlock.Type, FrameError | Schema.SchemaError> => {
  if (bytes.length !== CONFIG_LEN) {
    return Result.fail(
      new FrameLength({ actual: bytes.length, expected: CONFIG_LEN })
    );
  }

  return Schema.decodeUnknownResult(ConfigBlock)({
    liftOff: bytes[LIFT_OFF],
    pollingIndex: bytes[POLLING_INDEX],
  });
};

export const decodeSettingsBlock = (
  bytes: Uint8Array
): Result.Result<typeof Settings.Type, FrameError | Schema.SchemaError> => {
  if (bytes.length !== CONFIG_LEN) {
    return Result.fail(
      new FrameLength({ actual: bytes.length, expected: CONFIG_LEN })
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return Schema.decodeUnknownResult(Settings)({
    activeStage: bytes[ACTIVE_STAGE],
    debounceMs: bytes[DEBOUNCE],
    liftOff: bytes[LIFT_OFF],
    motionSync: bytes[MOTION_SYNC],
    pollingIndex: bytes[POLLING_INDEX],
    sleepSeconds: view.getUint16(SLEEP, true),
  });
};

const Byte = Schema.Int.check(Schema.isBetween({ maximum: 0xff, minimum: 0 }));

const Word = Schema.Int.check(
  Schema.isBetween({ maximum: 0xff_ff, minimum: 0 })
);

export const DpiStage = Schema.Struct({
  colour: Schema.Tuple([Byte, Byte, Byte]),
  enabled: Schema.Boolean,
  x: Word,
  y: Word,
});

export const decodeStages = (
  bytes: Uint8Array
): Result.Result<
  readonly (typeof DpiStage.Type)[],
  FrameError | Schema.SchemaError
> => {
  if (bytes.length !== CONFIG_LEN) {
    return Result.fail(
      new FrameLength({ actual: bytes.length, expected: CONFIG_LEN })
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const stages = Array.from({ length: DPI_STAGES }, (_stage, slot) => {
    const at = stageOffset(slot);

    return {
      colour: [bytes[at + 6], bytes[at + 7], bytes[at + 8]],
      enabled: bytes[at] === 1,
      x: view.getUint16(at + 2, true),
      y: view.getUint16(at + 4, true),
    };
  });

  return Schema.decodeUnknownResult(Schema.Array(DpiStage))(stages);
};

export const decodeDisplayBlock = (
  bytes: Uint8Array
): Result.Result<typeof DisplayBlock.Type, FrameError | Schema.SchemaError> => {
  if (bytes.length !== DISPLAY_LEN) {
    return Result.fail(
      new FrameLength({ actual: bytes.length, expected: DISPLAY_LEN })
    );
  }

  return Schema.decodeUnknownResult(DisplayBlock)({
    mode: bytes[DISPLAY_MODE],
  });
};

export const decodeBatteryReply = (
  data: Uint8Array
): Result.Result<typeof Battery.Type, FrameError | Schema.SchemaError> => {
  if (data.length < 2) {
    return Result.fail(new FrameLength({ actual: data.length, expected: 2 }));
  }

  return Schema.decodeUnknownResult(Battery)({
    charging: data[1] === 1,
    percent: data[0],
  });
};
