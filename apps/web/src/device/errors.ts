/* oxlint-disable unicorn/throw-new-error, eslint/max-classes-per-file */
import type { FrameError } from "@beastx-ctl/protocol";
import { Schema } from "effect";

import type { GateStoreError } from "./gate-store";

export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  { message: Schema.String }
) {}

export class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {
  cmd: Schema.Number,
}) {}

export class NotReady extends Schema.TaggedError<NotReady>()("NotReady", {
  ready: Schema.Number,
}) {}

export class RetriesExhausted extends Schema.TaggedError<RetriesExhausted>()(
  "RetriesExhausted",
  { cmd: Schema.Number }
) {}

export class BackupRequired extends Schema.TaggedError<BackupRequired>()(
  "BackupRequired",
  {}
) {}

export class ExperimentalOff extends Schema.TaggedError<ExperimentalOff>()(
  "ExperimentalOff",
  {}
) {}

export class WriteMismatch extends Schema.TaggedError<WriteMismatch>()(
  "WriteMismatch",
  {
    actual: Schema.Number,
    expected: Schema.Number,
    field: Schema.String,
  }
) {}

export type DeviceError =
  | BackupRequired
  | ExperimentalOff
  | FrameError
  | GateStoreError
  | NotReady
  | RetriesExhausted
  | Schema.SchemaError
  | Timeout
  | TransportError
  | WriteMismatch;
