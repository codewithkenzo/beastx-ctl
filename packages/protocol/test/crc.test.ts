import { describe, expect, it } from "vitest";

import { crc16Modbus } from "../src/index";

const CHECK_INPUT = Uint8Array.of(
  0x31,
  0x32,
  0x33,
  0x34,
  0x35,
  0x36,
  0x37,
  0x38,
  0x39
);

describe("CRC-16/MODBUS", () => {
  it("matches the standard check value for '123456789'", () => {
    expect(crc16Modbus(CHECK_INPUT)).toBe(0x4b_37);
  });
});
