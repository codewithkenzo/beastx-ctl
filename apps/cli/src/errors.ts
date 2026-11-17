/* oxlint-disable unicorn/throw-new-error, eslint/max-classes-per-file */
import type { FrameError } from "@beastx-ctl/protocol";
import { Option, Schema } from "effect";

export class IoError extends Schema.TaggedError<IoError>()("IoError", {
  path: Schema.String,
  reason: Schema.String,
}) {}

export class ConfigReplyMissing extends Schema.TaggedError<ConfigReplyMissing>()(
  "ConfigReplyMissing",
  {}
) {}

export type StatusError =
  | IoError
  | ConfigReplyMissing
  | FrameError
  | Schema.SchemaError;

export const describeError = (error: StatusError): string =>
  `${error._tag} ${JSON.stringify(error)}`;

export interface NodeFault {
  readonly code: Option.Option<string>;
  readonly reason: string;
}

const NodeError = Schema.Struct({ code: Schema.String });

export const nodeFault = (cause: unknown): NodeFault => {
  const decoded = Schema.decodeUnknownOption(NodeError)(cause);

  return {
    code: Option.isSome(decoded)
      ? Option.some(decoded.value.code)
      : Option.none(),
    reason: String(cause),
  };
};
