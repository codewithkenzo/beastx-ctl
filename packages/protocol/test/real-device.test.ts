import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { writeConfigPatch } from "../src/index";
import {
  addressOf,
  applyFrames,
  bytesOf,
  changedBytes,
  tagOf,
} from "./helpers";

const STAGE_COUNT_AT = 9;
const ACTIVE_AT = 12;
const STAGE_BASE = 14;
const STAGE_STRIDE = 9;

const CAPTURED_CONFIG =
  "00 05 03 04 00 01 00 00 ff 01 00 03 00 00 01 00 b0 04 40 06 00 ff 00 01 00 20 03 80 0c 00 00 ff 01 00 40 06 88 13 ff 00 00 01 00 80 0c 64 19 9d 00 7e 01 00 00 19 90 01 14 ff ff 01 00 e0 2e 90 01 ff 61 00 01 00 80 3e 90 01 ff a1 50 01 00 90 65 90 01 96 c8 fe 3c 00 58 02 0a 01 01 00 00 00 00 00 00 00 00 00 00 00 01 00 00 32 36 21 06 04 10 00 00 00 00";

const captured = bytesOf(CAPTURED_CONFIG);

describe("captured owner block", () => {
  it("reads a 117-byte block with block[9] set and all eight stages on", () => {
    expect(captured).toHaveLength(117);
    expect(captured[STAGE_COUNT_AT]).toBe(1);

    for (let slot = 0; slot < 8; slot += 1) {
      expect(captured[STAGE_BASE + slot * STAGE_STRIDE]).toBe(1);
    }
  });

  it("turning stage 8 off changes only block[77], sends only its chunk, and keeps block[9]", () => {
    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, captured, { stage: { enable: false, index: 7 } })
    );

    const applied = applyFrames(captured, frames);

    expect(frames.map(addressOf)).toStrictEqual([72]);
    expect(changedBytes(captured, applied)).toStrictEqual([77]);
    expect(applied[STAGE_COUNT_AT]).toBe(1);
  });

  it("setting activeStage to 3 changes only block[12] and keeps block[9]", () => {
    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, captured, { activeStage: 3 })
    );

    const applied = applyFrames(captured, frames);

    expect(frames.map(addressOf)).toStrictEqual([0]);
    expect(changedBytes(captured, applied)).toStrictEqual([ACTIVE_AT]);
    expect(applied[ACTIVE_AT]).toBe(3);
    expect(applied[STAGE_COUNT_AT]).toBe(1);
  });

  it("turning off the active stage is refused", () => {
    expect(
      tagOf(
        writeConfigPatch(0, captured, {
          stage: { enable: false, index: captured[ACTIVE_AT] ?? 0 },
        })
      )
    ).toBe("UnsupportedValue");
  });
});
