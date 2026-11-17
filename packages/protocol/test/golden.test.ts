import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { writeConfigPatch, writeDisplayFrame } from "../src/index";
import { bytesOf, hex, tagOf } from "./helpers";

const CONFIG_BASE = bytesOf(
  "00 04 04 04 00 00 21 00 95 01 00 00 00 00 01 00 40 06 40 06 10 00 c8 01"
);

const DISPLAY_BASE = bytesOf("04 04 04 21 00 95 00 32 3c 00 00 01 00");

const POLL_4000 =
  "04 7f 07 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 05 00 00 01 00 40 06 40 06 10 00 c8 01";

const configBlock = (highMode: number, polling = 0): Uint8Array => {
  const block = new Uint8Array(117);
  block.set(CONFIG_BASE);
  block[10] = highMode;
  block[11] = polling;

  return block;
};

const configGolden = [
  {
    bytes:
      "04 76 c1 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 03 00 00 01 00 40 06 40 06 10 00 c8 01",
    liftOff: 0,
    name: "LOD 1mm",
    polling: 3,
  },
  {
    bytes:
      "04 72 3d 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 03 00 01 01 00 40 06 40 06 10 00 c8 01",
    liftOff: 1,
    name: "LOD 2mm",
    polling: 3,
  },
  {
    bytes:
      "04 73 02 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 00 00 00 01 00 40 06 40 06 10 00 c8 01",
    liftOff: 0,
    name: "Poll 125Hz",
    polling: 0,
  },
  {
    bytes:
      "04 71 83 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 01 00 00 01 00 40 06 40 06 10 00 c8 01",
    liftOff: 0,
    name: "Poll 250Hz",
    polling: 1,
  },
  {
    bytes:
      "04 74 40 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 02 00 00 01 00 40 06 40 06 10 00 c8 01",
    liftOff: 0,
    name: "Poll 500Hz",
    polling: 2,
  },
  {
    bytes:
      "04 76 c1 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 03 00 00 01 00 40 06 40 06 10 00 c8 01",
    liftOff: 0,
    name: "Poll 1000Hz",
    polling: 3,
  },
  {
    bytes:
      "04 7d 86 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 04 00 00 01 00 40 06 40 06 10 00 c8 01",
    liftOff: 0,
    name: "Poll 2000Hz",
    polling: 4,
  },
  {
    bytes: POLL_4000,
    liftOff: 0,
    name: "Poll 4000Hz",
    polling: 5,
  },
];

const displayGolden = [
  {
    bytes:
      "04 c0 96 36 0d 00 00 00 04 04 04 21 00 95 00 32 3c 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00",
    mode: 0,
    name: "Display Default",
  },
  {
    bytes:
      "04 91 6a 36 0d 00 00 00 04 04 04 21 00 95 01 32 3c 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00",
    mode: 1,
    name: "Display Custom",
  },
];

describe("golden config writes rebuild from the base block", () => {
  it.each(configGolden)("$name", (golden) => {
    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, configBlock(0, golden.polling === 0 ? 1 : 0), {
        liftOff: golden.liftOff,
        pollingIndex: golden.polling,
      })
    );

    expect(frames.map((frame) => hex(frame.subarray(0, 32)))).toStrictEqual([
      golden.bytes,
    ]);
    expect(frames.map((frame) => frame.subarray(32))).toStrictEqual([
      new Uint8Array(32),
    ]);
  });
});

describe("High mode and polling (D-1)", () => {
  it("clears High mode when polling is above 1000 Hz", () => {
    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, configBlock(1), { pollingIndex: 5 })
    );

    expect(frames.map((frame) => hex(frame.subarray(0, 32)))).toStrictEqual([
      POLL_4000,
    ]);
  });

  it("keeps High mode at 1000 Hz", () => {
    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, configBlock(1), { pollingIndex: 3 })
    );

    expect(frames[0]?.[8 + 10]).toBe(1);
  });
});

describe("golden display writes rebuild from the base block", () => {
  it.each(displayGolden)("$name", (golden) => {
    const frame = Result.getOrThrow(
      writeDisplayFrame(0, DISPLAY_BASE, { mode: golden.mode })
    );

    expect(hex(frame.subarray(0, 32))).toBe(golden.bytes);
    expect(frame.subarray(32)).toStrictEqual(new Uint8Array(32));
  });
});

describe("typed rejects before any frame is built", () => {
  it.each([6, -1, 1.5])("rejects polling index %s", (pollingIndex) => {
    expect(tagOf(writeConfigPatch(0, configBlock(0), { pollingIndex }))).toBe(
      "OutOfRange"
    );
  });

  it.each([2, -1])("rejects lift-off %s", (liftOff) => {
    expect(tagOf(writeConfigPatch(0, configBlock(0), { liftOff }))).toBe(
      "OutOfRange"
    );
  });

  it.each([2, -1])("rejects display mode %s", (mode) => {
    expect(tagOf(writeDisplayFrame(0, DISPLAY_BASE, { mode }))).toBe(
      "OutOfRange"
    );
  });

  it("rejects a config block that is not 117 bytes", () => {
    expect(tagOf(writeConfigPatch(0, CONFIG_BASE, { pollingIndex: 1 }))).toBe(
      "FrameLength"
    );
  });
});
