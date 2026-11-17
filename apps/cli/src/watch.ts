import { Console, Duration, Effect, Option, Random, Ref } from "effect";

import { describeError } from "./errors";
import type { StatusError } from "./errors";
import { readStatus, toModuleLine } from "./status";

const TICK_INTERVAL = Duration.seconds(5);
const MAX_START_OFFSET_MS = 2500;

export type Printed = Ref.Ref<Option.Option<string>>;

const reportTickError = (error: StatusError) =>
  Console.error(`beastx: ${describeError(error)}`);

const claimChange = (printed: Printed, line: string) =>
  Ref.modify(printed, (previous) =>
    Option.exists(previous, (value) => value === line)
      ? [false, previous]
      : [true, Option.some(line)]
  );

const printIfChanged = Effect.fn("watch.printIfChanged")(
  function* printIfChanged(printed: Printed, line: string) {
    if (yield* claimChange(printed, line)) {
      yield* Console.log(line);
    }
  }
);

export const watchTick = Effect.fn("watch.tick")(function* watchTick(
  printed: Printed
) {
  yield* readStatus().pipe(
    Effect.flatMap((reading) =>
      printIfChanged(printed, JSON.stringify(toModuleLine(reading)))
    ),
    Effect.catch(reportTickError)
  );
});

export const watchLines = Effect.fn("watch")(function* watchLines() {
  const printed: Printed = yield* Ref.make(Option.none<string>());
  const offset = yield* Random.nextIntBetween(0, MAX_START_OFFSET_MS);

  yield* watchTick(printed);
  yield* Effect.sleep(Duration.millis(offset));

  return yield* Effect.forever(
    watchTick(printed).pipe(Effect.andThen(Effect.sleep(TICK_INTERVAL)))
  );
});
