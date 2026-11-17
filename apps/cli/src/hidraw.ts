import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { Context, Effect, Layer, Option } from "effect";
import type { Scope } from "effect";

import { IoError, nodeFault } from "./errors";
import type { NodeFault } from "./errors";

const REPORT_LEN = 64;
const READ_WRITE_NONBLOCK = constants.O_RDWR + constants.O_NONBLOCK;

export interface HidSession {
  readonly write: (frame: Uint8Array) => Effect.Effect<void, IoError>;
  readonly read: Effect.Effect<Option.Option<Uint8Array>, IoError>;
}

export class HidRaw extends Context.Service<
  HidRaw,
  {
    readonly open: (
      path: string
    ) => Effect.Effect<HidSession, IoError, Scope.Scope>;
  }
>()("beastx/HidRaw") {}

type Handle = Awaited<ReturnType<typeof open>>;

const ioFailure = (path: string, fault: NodeFault): IoError =>
  new IoError({ path, reason: fault.reason });

const recoverEagain =
  (path: string) =>
  (error: NodeFault): Effect.Effect<Option.Option<never>, IoError> =>
    Option.exists(error.code, (code) => code === "EAGAIN")
      ? Effect.succeedNone
      : Effect.fail(ioFailure(path, error));

const readReport = async (
  handle: Handle
): Promise<Option.Option<Uint8Array>> => {
  const buffer = new Uint8Array(REPORT_LEN);
  const { bytesRead } = await handle.read(buffer, 0, REPORT_LEN, null);

  return bytesRead === REPORT_LEN ? Option.some(buffer) : Option.none();
};

const writeFrame = (
  path: string,
  handle: Handle,
  frame: Uint8Array
): Effect.Effect<void, IoError> =>
  Effect.tryPromise({
    catch: (cause) => ioFailure(path, nodeFault(cause)),
    try: () => handle.write(frame),
  }).pipe(
    Effect.flatMap(({ bytesWritten }) =>
      bytesWritten === frame.length
        ? Effect.void
        : Effect.fail(
            new IoError({
              path,
              reason: `short write: ${bytesWritten} of ${frame.length}`,
            })
          )
    )
  );

const sessionOf = (path: string, handle: Handle): HidSession => ({
  read: Effect.tryPromise({
    catch: (cause) => nodeFault(cause),
    try: () => readReport(handle),
  }).pipe(Effect.catch(recoverEagain(path))),
  write: (frame) => writeFrame(path, handle, frame),
});

const openHidraw = (path: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      catch: (cause) => ioFailure(path, nodeFault(cause)),
      try: () => open(path, READ_WRITE_NONBLOCK),
    }),
    (handle) =>
      Effect.tryPromise({
        catch: (cause) => ioFailure(path, nodeFault(cause)),
        try: () => handle.close(),
      }).pipe(Effect.ignore)
  ).pipe(Effect.map((handle) => sessionOf(path, handle)));

export const hidrawLayer = Layer.succeed(HidRaw)({ open: openHidraw });
