import { Command } from "@beastx-ctl/protocol";
import { Effect, Layer, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import { IoError } from "../src/errors";
import { HidRaw } from "../src/hidraw";
import type { HidSession } from "../src/hidraw";
import { readStatus, toModuleLine } from "../src/status";
import { Sysfs } from "../src/sysfs";
import {
  configMemory,
  configReply,
  deviceSession,
  foreignReport,
  report,
} from "./fixtures";

const RECEIVER_ID = "HID_ID=0003:000036A7:0000A887\n";
const PROFILE = 0;

const PING_READY = report(Command.Ping, [0xff]);
const BATTERY_64_CHARGING = report(Command.Battery, [64, 1]);
const RETRY = report(0x50, []);

interface Script {
  readonly ping?: Uint8Array;
  readonly batteries: readonly Uint8Array[];
  readonly memory?: Uint8Array;
}

const answerWith = (script: Script) => {
  const batteries = [...script.batteries];

  return (frame: Uint8Array): Uint8Array | undefined => {
    const cmd = frame.at(3);

    if (cmd === Command.Ping) {
      return script.ping;
    }

    if (cmd === Command.Battery) {
      return batteries.length > 1 ? batteries.shift() : batteries[0];
    }

    return script.memory
      ? configReply(frame, script.memory, PROFILE)
      : undefined;
  };
};

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const receiverFiles = (name: string, iface: string) => ({
  [`/sys/class/hidraw/${name}/device/uevent`]: encode(RECEIVER_ID),
  [`/sys/class/hidraw/${name}/device/../bInterfaceNumber`]: encode(
    `${iface}\n`
  ),
  [`/sys/class/hidraw/${name}/device/report_descriptor`]: Uint8Array.from([
    0x06, 0x1c, 0xff,
  ]),
});

const sysfsWith = (
  names: readonly string[],
  files: Readonly<Record<string, Uint8Array>>
) =>
  Layer.succeed(Sysfs)({
    listDir: () => Effect.succeed(names),
    readBytes: (path) => Effect.succeed(Option.fromNullishOr(files[path])),
  });

const hidWith = (session: HidSession) =>
  Layer.succeed(HidRaw)({ open: () => Effect.succeed(session) });

const interfaceZero = (name: string) =>
  sysfsWith([name], receiverFiles(name, "00"));

const unusedHid = Layer.succeed(HidRaw)({
  open: () =>
    Effect.fail(new IoError({ path: "/dev/hidraw9", reason: "unused" })),
});

const runStatus = (layer: Layer.Layer<Sysfs | HidRaw>) =>
  Effect.runPromise(readStatus().pipe(Effect.provide(layer)));

describe("module line shapes", () => {
  it("shapes an online reading with its DPI stage", () => {
    expect(
      toModuleLine({
        charging: true,
        dpi: 1600,
        kind: "online",
        percent: 64,
        stage: 2,
      })
    ).toStrictEqual({
      alt: "charging",
      class: "beastx",
      dpi: 1600,
      percentage: 64,
      stage: 2,
      text: "64% · 1600",
      tooltip: "Beast X 4K · 64% · charging · 1600 DPI (stage 2)",
    });
  });

  it("shapes asleep and none", () => {
    expect(toModuleLine({ kind: "asleep" })).toStrictEqual({
      alt: "asleep",
      class: "beastx asleep",
      text: "zz",
      tooltip: "Beast X 4K asleep",
    });
    expect(toModuleLine({ kind: "none" })).toStrictEqual({
      alt: "none",
      text: "",
    });
  });
});

describe("status reading", () => {
  it("reports none when only interface 01 exists", async () => {
    const reading = await runStatus(
      Layer.mergeAll(
        sysfsWith(["hidraw9"], receiverFiles("hidraw9", "01")),
        unusedHid
      )
    );

    expect(toModuleLine(reading)).toStrictEqual({ alt: "none", text: "" });
  });

  it("reads battery and the active DPI, skipping foreign reports", async () => {
    const { session, written } = deviceSession(
      answerWith({
        batteries: [BATTERY_64_CHARGING],
        memory: configMemory(1, [800, 1600]),
        ping: PING_READY,
      }),
      [report(Command.ReadDisplay, [0x01]), foreignReport(3)]
    );

    const reading = await runStatus(
      Layer.mergeAll(
        sysfsWith(["hidraw9", "hidraw8"], {
          ...receiverFiles("hidraw9", "01"),
          ...receiverFiles("hidraw8", "00"),
        }),
        hidWith(session)
      )
    );

    expect(toModuleLine(reading)).toStrictEqual({
      alt: "charging",
      class: "beastx",
      dpi: 1600,
      percentage: 64,
      stage: 2,
      text: "64% · 1600",
      tooltip: "Beast X 4K · 64% · charging · 1600 DPI (stage 2)",
    });
    expect(written.map((frame) => frame[3])).toStrictEqual([
      Command.Ping,
      Command.Battery,
      Command.ReadConfig,
      Command.ReadConfig,
      Command.ReadConfig,
    ]);
  });

  it("reads stage one's X from the first chunk alone", async () => {
    const { session, written } = deviceSession(
      answerWith({
        batteries: [BATTERY_64_CHARGING],
        memory: configMemory(0, [800]),
        ping: PING_READY,
      })
    );

    const reading = await runStatus(
      Layer.mergeAll(interfaceZero("hidraw8"), hidWith(session))
    );

    expect(toModuleLine(reading)).toMatchObject({ dpi: 800, stage: 1 });
    expect(written.map((frame) => frame[3])).toStrictEqual([
      Command.Ping,
      Command.Battery,
      Command.ReadConfig,
      Command.ReadConfig,
    ]);
  });

  it("resends the battery request on the retry marker", async () => {
    const { session, written } = deviceSession(
      answerWith({
        batteries: [RETRY, BATTERY_64_CHARGING],
        memory: configMemory(0, [800]),
        ping: PING_READY,
      })
    );

    const reading = await runStatus(
      Layer.mergeAll(interfaceZero("hidraw8"), hidWith(session))
    );

    expect(toModuleLine(reading).alt).toBe("charging");
    expect(
      written.filter((frame) => frame[3] === Command.Battery)
    ).toHaveLength(2);
  });

  it("reports asleep after three resends all answer busy", async () => {
    const { session, written } = deviceSession(
      answerWith({
        batteries: [RETRY, RETRY, RETRY, RETRY],
        memory: configMemory(0, [800]),
        ping: PING_READY,
      })
    );

    const reading = await runStatus(
      Layer.mergeAll(interfaceZero("hidraw8"), hidWith(session))
    );

    expect(toModuleLine(reading).alt).toBe("asleep");
    expect(
      written.filter((frame) => frame[3] === Command.Battery)
    ).toHaveLength(4);
  });

  it("reports asleep when the ping is not ready", async () => {
    const { session } = deviceSession(
      answerWith({
        batteries: [BATTERY_64_CHARGING],
        memory: configMemory(0, [800]),
        ping: report(Command.Ping, [0x00]),
      })
    );

    const reading = await runStatus(
      Layer.mergeAll(interfaceZero("hidraw8"), hidWith(session))
    );

    expect(toModuleLine(reading).alt).toBe("asleep");
  });

  it("reports asleep when the ping never gets a reply", async () => {
    const { session } = deviceSession(
      answerWith({ batteries: [BATTERY_64_CHARGING] })
    );

    const reading = await runStatus(
      Layer.mergeAll(interfaceZero("hidraw8"), hidWith(session))
    );

    expect(toModuleLine(reading).alt).toBe("asleep");
  });

  it("fails with ConfigReplyMissing when a config read gets no reply", async () => {
    const { session } = deviceSession(
      answerWith({
        batteries: [BATTERY_64_CHARGING],
        ping: PING_READY,
      })
    );

    const result = await Effect.runPromise(
      readStatus().pipe(
        Effect.result,
        Effect.provide(
          Layer.mergeAll(interfaceZero("hidraw8"), hidWith(session))
        )
      )
    );

    expect(Result.isFailure(result) && result.failure._tag).toBe(
      "ConfigReplyMissing"
    );
  });
});
