import { describe, expect, it } from "vitest";

import { connectNotice, writeNotice } from "./error-copy";
import {
  BackupRequired,
  ExperimentalOff,
  RetriesExhausted,
  Timeout,
  TransportError,
  WriteMismatch,
} from "./errors";
import { NoVendorCollection } from "./webhid";

describe(writeNotice, () => {
  it("maps device write failures to their copy keys and variables", () => {
    expect(
      writeNotice(
        new WriteMismatch({ actual: 1, expected: 0, field: "liftOff" })
      )
    ).toStrictEqual({
      key: "write.mismatch",
      vars: { actual: 1, expected: 0, field: "liftOff" },
    });
    expect(writeNotice(new Timeout({ cmd: 0x06 }))).toStrictEqual({
      key: "write.timeout",
      vars: { ms: 500 },
    });
    expect(writeNotice(new RetriesExhausted({ cmd: 0x06 }))).toStrictEqual({
      key: "write.timeout",
      vars: { ms: 500 },
    });
    expect(
      writeNotice(new TransportError({ message: "sendReport failed" }))
    ).toStrictEqual({
      key: "write.transport",
      vars: { reason: "sendReport failed" },
    });
    expect(writeNotice(new BackupRequired({}))).toStrictEqual({
      key: "write.backup",
      vars: {},
    });
  });

  it("returns no notice for experimental-off, which is logged instead", () => {
    expect(writeNotice(new ExperimentalOff({}))).toBeUndefined();
  });
});

describe(connectNotice, () => {
  it("maps a receiver without the vendor collection to the interface message", () => {
    expect(
      connectNotice(new NoVendorCollection({ productId: 0xa8_87 }))
    ).toStrictEqual({ key: "error.interface", vars: {} });
  });

  it("returns no notice while no pick has failed", () => {
    expect(connectNotice(null)).toBeUndefined();
  });
});
