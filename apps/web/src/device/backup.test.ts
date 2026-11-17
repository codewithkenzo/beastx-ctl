import { describe, expect, it } from "vitest";

import { backupDocument, backupFile } from "./backup";

describe(backupDocument, () => {
  it("writes receiver, date, profile, config and display as hex, plus battery", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");

    const document: unknown = JSON.parse(
      backupDocument(
        {
          battery: { charging: false, percent: 72 },
          config: new Uint8Array([0x00, 0xab, 0xff]),
          display: new Uint8Array([0x01]),
          profile: 1,
        },
        date
      )
    );

    expect(document).toStrictEqual({
      battery: { charging: false, percent: 72 },
      config: "00abff",
      date: "2026-01-02T03:04:05.000Z",
      display: "01",
      profile: 1,
      receiver: "36a7:a887",
    });
  });
});

describe(backupFile, () => {
  it("names the file by the UTC date", () => {
    expect(backupFile(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "backup-2026-01-02.json"
    );
  });
});
