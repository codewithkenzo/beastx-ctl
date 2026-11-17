import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { buildFrame, Command } from "../src/frame";
import {
  pingFrame,
  readActiveProfileFrame,
  readConfigFrames,
  readDisplayFrame,
} from "../src/index";
import { hex } from "./helpers";

const CONFIG_LAST_LEN = 21;

const head = (frame: Uint8Array): string => hex(frame.subarray(0, 12));

const configFrames = (profile: number): Uint8Array[] =>
  Result.getOrThrow(readConfigFrames(profile));

describe("derived frames from the read path", () => {
  it("D1 ping (0xaa)", () => {
    expect(head(Result.getOrThrow(pingFrame()))).toBe(
      "04 6b 6b aa 00 00 00 00 00 00 00 00"
    );
  });

  it("D2 begin (0x01)", () => {
    expect(head(Result.getOrThrow(buildFrame(Command.Begin, 0, 0)))).toBe(
      "04 2b bf 01 00 00 00 00 00 00 00 00"
    );
  });

  it("D3 end (0x02)", () => {
    expect(head(Result.getOrThrow(buildFrame(Command.End, 0, 0)))).toBe(
      "04 6b bd 02 00 00 00 00 00 00 00 00"
    );
  });

  it("D4 active profile read, one byte at 0", () => {
    expect(head(Result.getOrThrow(readActiveProfileFrame()))).toBe(
      "04 28 38 05 01 00 00 00 00 00 00 00"
    );
  });

  it("D5..D8 config reads at profile 0: 24 bytes at 0, 24, 48, 72", () => {
    expect(configFrames(0).slice(0, 4).map(head)).toStrictEqual([
      "04 12 78 05 18 00 00 00 00 00 00 00",
      "04 13 80 05 18 18 00 00 00 00 00 00",
      "04 13 c8 05 18 30 00 00 00 00 00 00",
      "04 13 10 05 18 48 00 00 00 00 00 00",
    ]);
  });

  it("D9 config read of the last 21 bytes at 96", () => {
    expect(configFrames(0)[4]?.subarray(0, 8)).toStrictEqual(
      Uint8Array.of(0x04, 0x0d, 0x18, 0x05, CONFIG_LAST_LEN, 0x60, 0x00, 0x00)
    );
  });

  it("D10 display read, 13 bytes at 0", () => {
    expect(head(Result.getOrThrow(readDisplayFrame(0)))).toBe(
      "04 35 dc 35 0d 00 00 00 00 00 00 00"
    );
  });

  it("rejects a chunk longer than the 24-byte driver limit", () => {
    const frame = buildFrame(Command.ReadConfig, 0x19, 0);
    expect(Result.isFailure(frame)).toBeTruthy();
  });
});
