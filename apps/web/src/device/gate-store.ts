/* oxlint-disable unicorn/throw-new-error, eslint/max-classes-per-file */
import { Context, Effect, Layer, Option, Ref, Result, Schema } from "effect";

export class GateStoreError extends Schema.TaggedError<GateStoreError>()(
  "GateStoreError",
  { message: Schema.String }
) {}

const STORAGE_KEY = "beastx.gate";

const GateRecord = Schema.Struct({
  backedUpAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  experimental: Schema.Boolean,
});

const GateJson = Schema.fromJsonString(GateRecord);

export type StoredGate = typeof GateRecord.Type;

export const CLOSED_STORED: StoredGate = {
  backedUpAt: null,
  experimental: false,
};

const readStored = Effect.try({
  catch: (error) =>
    new GateStoreError({
      message: error instanceof Error ? error.message : "read failed",
    }),
  try: () => globalThis.localStorage.getItem(STORAGE_KEY),
});

const writeStored = (gate: StoredGate) =>
  Effect.try({
    catch: (error) =>
      new GateStoreError({
        message: error instanceof Error ? error.message : "write failed",
      }),
    try: () => {
      globalThis.localStorage.setItem(
        STORAGE_KEY,
        Schema.encodeSync(GateJson)(gate)
      );
    },
  });

const loadStored = Effect.gen(function* loadGate() {
  const read = yield* Effect.result(readStored);

  if (Result.isFailure(read)) {
    yield* Effect.logWarning(
      "gate store unreadable, reading as closed",
      read.failure
    );

    return CLOSED_STORED;
  }

  return Option.getOrElse(
    Schema.decodeUnknownOption(GateJson)(read.success),
    () => CLOSED_STORED
  );
});

export class GateStore extends Context.Service<
  GateStore,
  {
    readonly load: Effect.Effect<StoredGate>;
    readonly save: (gate: StoredGate) => Effect.Effect<void, GateStoreError>;
  }
>()("device/GateStore") {
  static readonly layer = Layer.succeed(GateStore, {
    load: loadStored,
    save: writeStored,
  });

  static readonly memory = (initial: StoredGate = CLOSED_STORED) =>
    Layer.effect(
      GateStore,
      Effect.gen(function* memoryGateStore() {
        const state = yield* Ref.make(initial);

        return {
          load: Ref.get(state),
          save: (gate: StoredGate) => Ref.set(state, gate),
        };
      })
    );
}
