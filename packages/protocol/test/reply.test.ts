import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { crc16Modbus } from "../src/crc";
import { buildFrame, Command } from "../src/frame";
import { decodeReplyFrame } from "../src/index";
import { tagOf } from "./helpers";

const requestFor = (cmd: number, length: number): Uint8Array =>
  Result.getOrThrow(buildFrame(cmd, length, 0));

const seal = (frame: Uint8Array): void => {
  const crc = crc16Modbus(frame.subarray(3, 32));
  frame[1] = crc % 256;
  frame[2] = Math.floor(crc / 256);
};

const replyWith = (
  cmd: number,
  status: number,
  data: readonly number[] = [0]
): Uint8Array => {
  const frame = requestFor(cmd, data.length);
  frame[7] = status;
  frame.set(data, 8);
  seal(frame);

  return frame;
};

const READ_ONE = requestFor(Command.ReadConfig, 1);

describe("reply frame decoding", () => {
  it("decodes a clean reply", () => {
    expect(
      Result.getOrThrow(
        decodeReplyFrame(replyWith(Command.ReadConfig, 0x00), READ_ONE)
      )
    ).toStrictEqual({
      cmd: Command.ReadConfig,
      data: Uint8Array.of(0),
      status: 0,
    });
  });

  it("maps status 0xff to a typed DeviceStatus failure", () => {
    expect(
      tagOf(decodeReplyFrame(replyWith(Command.ReadConfig, 0xff), READ_ONE))
    ).toBe("DeviceStatus");
  });

  it("maps status 0xfe to a typed DeviceStatus failure", () => {
    expect(
      tagOf(decodeReplyFrame(replyWith(Command.ReadConfig, 0xfe), READ_ONE))
    ).toBe("DeviceStatus");
  });

  it("rejects a high CRC byte that does not match", () => {
    const frame = replyWith(Command.ReadConfig, 0x00);
    frame[2] = frame[2] === 0 ? 1 : 0;

    expect(tagOf(decodeReplyFrame(frame, READ_ONE))).toBe("ChecksumMismatch");
  });

  it("rejects a report with the wrong report ID", () => {
    const frame = replyWith(Command.ReadConfig, 0x00);
    frame[0] = 0x05;

    expect(tagOf(decodeReplyFrame(frame, READ_ONE))).toBe("BadReportId");
  });

  it("fails with FrameLength when the reply is short", () => {
    const short = replyWith(Command.ReadConfig, 0x00).subarray(0, 63);

    expect(tagOf(decodeReplyFrame(short, READ_ONE))).toBe("FrameLength");
  });

  it("takes the data length from the request, not the reply's echo", () => {
    const frame = replyWith(Command.ReadConfig, 0x00, [7]);
    frame[4] = 0x30;
    seal(frame);

    expect(
      Result.getOrThrow(decodeReplyFrame(frame, READ_ONE)).data
    ).toStrictEqual(Uint8Array.of(7));
  });
});
