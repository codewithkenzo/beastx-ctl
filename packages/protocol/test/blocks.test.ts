import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { decodeConfigBlock, decodeDisplayBlock } from "../src/index";
import { bytesOf, tagOf } from "./helpers";

const configBlock = (polling: number, liftOff: number): Uint8Array => {
  const block = new Uint8Array(117);
  block[11] = polling;
  block[13] = liftOff;

  return block;
};

describe("block decoders", () => {
  it("decodes polling and lift-off from a config block", () => {
    expect(
      Result.getOrThrow(decodeConfigBlock(configBlock(3, 1)))
    ).toStrictEqual({
      liftOff: 1,
      pollingIndex: 3,
    });
  });

  it("fails when the polling index is outside 0..5", () => {
    expect(tagOf(decodeConfigBlock(configBlock(6, 0)))).toBe("SchemaError");
  });

  it("decodes display mode from a 13-byte block", () => {
    const display = bytesOf("04 04 04 21 00 95 01 32 3c 00 00 01 00");

    expect(Result.getOrThrow(decodeDisplayBlock(display))).toStrictEqual({
      mode: 1,
    });
  });

  it("rejects a config block of the wrong length", () => {
    expect(tagOf(decodeConfigBlock(new Uint8Array(24)))).toBe("FrameLength");
  });
});
