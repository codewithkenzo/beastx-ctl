/* oxlint-disable unicorn/throw-new-error, eslint/max-classes-per-file */
import { Schema } from "effect";

export class OutOfRange extends Schema.TaggedError<OutOfRange>()("OutOfRange", {
  field: Schema.String,
  max: Schema.Finite,
  value: Schema.Finite,
}) {}

export class FrameLength extends Schema.TaggedError<FrameLength>()(
  "FrameLength",
  {
    actual: Schema.Finite,
    expected: Schema.Finite,
  }
) {}

export class UnsupportedCommand extends Schema.TaggedError<UnsupportedCommand>()(
  "UnsupportedCommand",
  { cmd: Schema.Finite }
) {}

export class BadReportId extends Schema.TaggedError<BadReportId>()(
  "BadReportId",
  {
    actual: Schema.Finite,
  }
) {}

export class ChecksumMismatch extends Schema.TaggedError<ChecksumMismatch>()(
  "ChecksumMismatch",
  { actual: Schema.Finite, expected: Schema.Finite }
) {}

export class DeviceStatus extends Schema.TaggedError<DeviceStatus>()(
  "DeviceStatus",
  {
    cmd: Schema.Finite,
    status: Schema.Finite,
  }
) {}

export class UnsupportedValue extends Schema.TaggedError<UnsupportedValue>()(
  "UnsupportedValue",
  { field: Schema.String, value: Schema.Finite }
) {}

export type FrameError =
  | OutOfRange
  | FrameLength
  | UnsupportedCommand
  | UnsupportedValue
  | BadReportId
  | ChecksumMismatch
  | DeviceStatus;
