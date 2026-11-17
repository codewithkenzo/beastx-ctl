import { Command } from "@beastx-ctl/protocol";
import { Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { describe, expect, it } from "vitest";

import { IoError } from "../src/errors";
import { HidRaw } from "../src/hidraw";
import { Sysfs } from "../src/sysfs";
import { watchLines, watchTick } from "../src/watch";
import {
  configMemory,
  configReply,
  deviceSession,
  foreignReport,
  report,
} from "./fixtures";

const RECEIVER_ID = "HID_ID=0003:000036A7:0000A887\n";
const PROFILE = 0;
const CONFIG = configMemory(0, [800]);

const PING_READY = report(Command.Ping, [0xff]);

const battery = (percent: number, charging: boolean): Uint8Array =>
  report(Command.Battery, [percent, charging ? 1 : 0]);

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const receiverFiles = new Map<string, Uint8Array>([
  ["/sys/class/hidraw/hidraw8/device/../bInterfaceNumber", encode("00\n")],
  [
    "/sys/class/hidraw/hidraw8/device/report_descriptor",
    Uint8Array.from([0x06, 0x1c, 0xff]),
  ],
  ["/sys/class/hidraw/hidraw8/device/uevent", encode(RECEIVER_ID)],
]);

const receiverSysfs = Layer.succeed(Sysfs)({
  listDir: () => Effect.succeed(["hidraw8"]),
  readBytes: (path) =>
    Effect.succeed(Option.fromNullishOr(receiverFiles.get(path))),
});

const failingSysfs = Layer.succeed(Sysfs)({
  listDir: () =>
    Effect.fail(new IoError({ path: "/sys/class/hidraw", reason: "EIO" })),
  readBytes: () => Effect.succeedNone,
});

const unusedHid = Layer.succeed(HidRaw)({
  open: () =>
    Effect.fail(new IoError({ path: "/dev/hidraw8", reason: "unused" })),
});

type Level = readonly [percent: number, charging: boolean];

const fakeDevice = (
  levels: readonly Level[],
  foreign: readonly Uint8Array[]
) => {
  const queuedLevels = [...levels];

  const nextBattery = (): Uint8Array | undefined => {
    const level =
      queuedLevels.length > 1 ? queuedLevels.shift() : levels.at(-1);

    return level ? battery(level[0], level[1]) : undefined;
  };

  const { session } = deviceSession((frame) => {
    const cmd = frame.at(3);

    if (cmd === Command.Ping) {
      return PING_READY;
    }

    if (cmd === Command.Battery) {
      return nextBattery();
    }

    return configReply(frame, CONFIG, PROFILE);
  }, foreign);

  return Layer.mergeAll(
    receiverSysfs,
    Layer.succeed(HidRaw)({ open: () => Effect.succeed(session) })
  );
};

const CHARGING_64 =
  '{"alt":"charging","class":"beastx","dpi":800,"percentage":64,"stage":1,"text":"64% · 800","tooltip":"Beast X 4K · 64% · charging · 800 DPI (stage 1)"}';

const CHARGING_63 =
  '{"alt":"charging","class":"beastx","dpi":800,"percentage":63,"stage":1,"text":"63% · 800","tooltip":"Beast X 4K · 63% · charging · 800 DPI (stage 1)"}';

describe("watch tick", () => {
  it("prints the first reading and skips an unchanged one", async () => {
    const program = Effect.gen(function* printTwice() {
      const printed = yield* Ref.make(Option.none<string>());
      yield* watchTick(printed);
      yield* watchTick(printed);

      return yield* TestConsole.logLines;
    });

    const lines = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(fakeDevice([[64, true]], []), TestConsole.layer)
        )
      )
    );

    expect(lines).toStrictEqual([CHARGING_64]);
  });

  it("drops foreign reports and keeps reading the battery", async () => {
    const program = Effect.gen(function* readOnce() {
      const printed = yield* Ref.make(Option.none<string>());
      yield* watchTick(printed);

      return {
        errors: yield* TestConsole.errorLines,
        lines: yield* TestConsole.logLines,
      };
    });

    const output = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeDevice(
              [[64, true]],
              [foreignReport(1), foreignReport(2), foreignReport(3)]
            ),
            TestConsole.layer
          )
        )
      )
    );

    expect(output).toStrictEqual({ errors: [], lines: [CHARGING_64] });
  });

  it("reports an IO error to stderr and prints nothing new", async () => {
    const program = Effect.gen(function* failOnce() {
      const printed = yield* Ref.make(Option.some(CHARGING_64));
      yield* watchTick(printed);

      return {
        errors: yield* TestConsole.errorLines,
        lines: yield* TestConsole.logLines,
      };
    });

    const output = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(failingSysfs, unusedHid, TestConsole.layer)
        )
      )
    );

    expect(output.lines).toStrictEqual([]);
    expect(output.errors).toHaveLength(1);
  });
});

describe("watch loop", () => {
  it("prints each change once across five-second ticks", async () => {
    const program = Effect.gen(function* runLoop() {
      const fiber = yield* Effect.forkChild(watchLines());
      yield* TestClock.adjust("12 seconds");
      yield* Fiber.interrupt(fiber);

      return yield* TestConsole.logLines;
    });

    const lines = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeDevice(
              [
                [64, true],
                [64, true],
                [63, true],
              ],
              []
            ),
            TestConsole.layer,
            TestClock.layer()
          )
        )
      )
    );

    expect(lines).toStrictEqual([CHARGING_64, CHARGING_63]);
  });
});
