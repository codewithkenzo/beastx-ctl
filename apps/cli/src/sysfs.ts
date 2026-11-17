import { readdir, readFile } from "node:fs/promises";

import { Context, Effect, Layer, Option } from "effect";

import { IoError, nodeFault } from "./errors";
import type { NodeFault } from "./errors";

export class Sysfs extends Context.Service<
  Sysfs,
  {
    readonly listDir: (
      path: string
    ) => Effect.Effect<readonly string[], IoError>;
    readonly readBytes: (
      path: string
    ) => Effect.Effect<Option.Option<Uint8Array>, IoError>;
  }
>()("beastx/Sysfs") {}

const MISSING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);

const isMissing = (fault: NodeFault): boolean =>
  Option.exists(fault.code, (code) => MISSING_CODES.has(code));

const recoverMissing =
  (path: string) =>
  (error: NodeFault): Effect.Effect<Option.Option<never>, IoError> =>
    isMissing(error)
      ? Effect.succeedNone
      : Effect.fail(new IoError({ path, reason: error.reason }));

const readOrMissing = <A>(
  path: string,
  read: () => Promise<A>
): Effect.Effect<Option.Option<A>, IoError> =>
  Effect.tryPromise({ catch: (cause) => nodeFault(cause), try: read }).pipe(
    Effect.asSome,
    Effect.catch(recoverMissing(path))
  );

export const sysfsLayer = Layer.succeed(Sysfs)({
  listDir: (path) =>
    readOrMissing(path, () => readdir(path)).pipe(
      Effect.map((names) => Option.getOrElse(names, (): string[] => []))
    ),
  readBytes: (path) => readOrMissing(path, () => readFile(path)),
});
