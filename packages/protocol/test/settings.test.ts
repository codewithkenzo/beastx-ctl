import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { buildFrame, Command } from "../src/frame";
import {
  assembleConfig,
  decodeActiveProfile,
  decodeBatteryReply,
  decodeReplyFrame,
  decodeSettingsBlock,
  decodeStages,
  readBatteryFrame,
  readConfigFrames,
  readDisplayFrame,
  writeConfigPatch,
  writeDisplayFrame,
} from "../src/index";
import { applyFrames, bytesOf, hex, tagOf } from "./helpers";

const replyFor = (
  cmd: number,
  data: readonly number[],
  crcHigh: number
): Uint8Array => {
  const bytes = new Uint8Array(64);
  bytes[0] = 0x04;
  bytes[2] = crcHigh;
  bytes[3] = cmd;
  bytes[4] = data.length;
  bytes.set(data, 8);

  return bytes;
};

const requestFor = (cmd: number, length: number): Uint8Array =>
  Result.getOrThrow(buildFrame(cmd, length, 0));

const zeroBlock = (): Uint8Array => new Uint8Array(117);

const chunksOf = (): Uint8Array[] =>
  [24, 24, 24, 24, 21].map((length, index) =>
    new Uint8Array(length).fill(index + 1)
  );

describe("active profile reply", () => {
  it("reads the profile index from the first data byte", () => {
    expect(Result.getOrThrow(decodeActiveProfile(Uint8Array.of(0, 1)))).toBe(0);
  });

  it("rejects a profile other than 0", () => {
    expect(tagOf(decodeActiveProfile(Uint8Array.of(1, 0)))).toBe("OutOfRange");
  });

  it("rejects an empty reply", () => {
    expect(tagOf(decodeActiveProfile(new Uint8Array()))).toBe("FrameLength");
  });
});

describe("DPI stages", () => {
  it("decodes the captured stage 0 record and leaves the rest disabled", () => {
    const block = new Uint8Array(117);
    block.set(
      Uint8Array.of(0x01, 0x00, 0x40, 0x06, 0x40, 0x06, 0x10, 0x00, 0xc8),
      14
    );
    const stages = Result.getOrThrow(decodeStages(block));

    expect(stages[0]).toStrictEqual({
      colour: [0x10, 0x00, 0xc8],
      enabled: true,
      x: 1600,
      y: 1600,
    });
    expect(stages).toHaveLength(8);
    expect(stages[1]?.enabled).toBeFalsy();
  });
});

describe("battery request", () => {
  it("builds the driver's exact 0x1a request", () => {
    const frame = Result.getOrThrow(readBatteryFrame());

    expect(hex(frame.subarray(0, 8))).toBe("04 64 6f 1a 06 00 00 00");
    expect(frame.subarray(8)).toStrictEqual(new Uint8Array(56));
  });
});

describe("reply CRC", () => {
  it("accepts a ping reply whose CRC does not match", () => {
    const reply = Result.getOrThrow(
      decodeReplyFrame(
        replyFor(Command.Ping, [0xff], 0x00),
        requestFor(Command.Ping, 1)
      )
    );

    expect(reply.cmd).toBe(Command.Ping);
  });

  it("still rejects a checked reply with a wrong CRC", () => {
    expect(
      tagOf(
        decodeReplyFrame(
          replyFor(Command.ReadConfig, [0], 0x00),
          requestFor(Command.ReadConfig, 1)
        )
      )
    ).toBe("ChecksumMismatch");
  });
});

describe("battery reply", () => {
  it("reads percent and charging from the reply data", () => {
    const reply = Result.getOrThrow(
      decodeReplyFrame(
        replyFor(Command.Battery, [72, 1], 0x00),
        requestFor(Command.Battery, 2)
      )
    );

    expect(Result.getOrThrow(decodeBatteryReply(reply.data))).toStrictEqual({
      charging: true,
      percent: 72,
    });
  });

  it("fails when the reply carries no charge byte", () => {
    expect(tagOf(decodeBatteryReply(bytesOf("48")))).toBe("FrameLength");
  });
});

describe("settings", () => {
  it("decodes sleep as a little-endian u16 at block[86..87]", () => {
    const block = new Uint8Array(117);
    block[86] = 0x2c;
    block[87] = 0x01;
    expect(Result.getOrThrow(decodeSettingsBlock(block)).sleepSeconds).toBe(
      300
    );
  });

  it("writes only the chunk that holds the changed byte", () => {
    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, zeroBlock(), { sleepSeconds: 30 })
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]?.subarray(3, 9)).toStrictEqual(
      bytesOf("06 18 48 00 00 00")
    );
    expect(frames[0]?.[8 + 14]).toBe(0x1e);
  });

  it("returns the patched block that its frames produce", () => {
    const { block, frames } = Result.getOrThrow(
      writeConfigPatch(0, zeroBlock(), { sleepSeconds: 30 })
    );

    expect(block).toStrictEqual(applyFrames(zeroBlock(), frames));
  });

  it.each([30, 60, 300])("accepts a %s second sleep", (sleepSeconds) => {
    expect(
      Result.isSuccess(writeConfigPatch(0, zeroBlock(), { sleepSeconds }))
    ).toBeTruthy();
  });

  it.each([0, 45, 0xff_ff])(
    "refuses a sleep of %s seconds outside the driver's set",
    (sleepSeconds) => {
      expect(tagOf(writeConfigPatch(0, zeroBlock(), { sleepSeconds }))).toBe(
        "UnsupportedValue"
      );
    }
  );

  it("refuses a debounce above 12 ms and accepts 12", () => {
    expect(tagOf(writeConfigPatch(0, zeroBlock(), { debounceMs: 13 }))).toBe(
      "OutOfRange"
    );
    expect(
      Result.isSuccess(writeConfigPatch(0, zeroBlock(), { debounceMs: 12 }))
    ).toBeTruthy();
  });

  it("refuses an active stage whose slot is not enabled", () => {
    const twoStages = zeroBlock();
    twoStages[14] = 1;
    twoStages[23] = 1;

    expect(tagOf(writeConfigPatch(0, twoStages, { activeStage: 2 }))).toBe(
      "UnsupportedValue"
    );
    expect(
      Result.isSuccess(writeConfigPatch(0, twoStages, { activeStage: 1 }))
    ).toBeTruthy();
  });

  it("refuses an active stage outside 0..7", () => {
    expect(tagOf(writeConfigPatch(0, zeroBlock(), { activeStage: 8 }))).toBe(
      "OutOfRange"
    );
  });
});

describe("profile is pinned to 0", () => {
  it("refuses profile 1 for a config write before any frame", () => {
    expect(tagOf(writeConfigPatch(1, zeroBlock(), { pollingIndex: 2 }))).toBe(
      "OutOfRange"
    );
  });

  it("refuses profile 1 for config reads", () => {
    expect(tagOf(readConfigFrames(1))).toBe("OutOfRange");
  });

  it("refuses profile 1 for display reads", () => {
    expect(tagOf(readDisplayFrame(1))).toBe("OutOfRange");
  });

  it("refuses profile 1 for display writes", () => {
    expect(tagOf(writeDisplayFrame(1, new Uint8Array(13), { mode: 0 }))).toBe(
      "OutOfRange"
    );
  });
});

describe("config assembly", () => {
  it("places each chunk at its start", () => {
    const block = Result.getOrThrow(assembleConfig(chunksOf()));

    expect(block).toHaveLength(117);
    expect(block[0]).toBe(1);
    expect(block[24]).toBe(2);
    expect(block[96]).toBe(5);
    expect(block[116]).toBe(5);
  });

  it("fails with FrameLength when a chunk is missing", () => {
    expect(tagOf(assembleConfig(chunksOf().slice(0, 4)))).toBe("FrameLength");
  });

  it("fails with FrameLength when a chunk has the wrong size", () => {
    const chunks = chunksOf();
    chunks[2] = new Uint8Array(23);

    expect(tagOf(assembleConfig(chunks))).toBe("FrameLength");
  });
});

describe("allowlist", () => {
  it("refuses an opcode outside the allowlist at buildFrame", () => {
    expect(tagOf(buildFrame(0x50, 0, 0))).toBe("UnsupportedCommand");
  });

  it.each([
    Command.Battery,
    Command.Ping,
    Command.ReadConfig,
    Command.ReadDisplay,
  ])("refuses data on read opcode 0x%s", (cmd) => {
    expect(tagOf(buildFrame(cmd, 1, 0, Uint8Array.of(1)))).toBe(
      "UnsupportedCommand"
    );
  });
});
