import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Deferred, Effect, Function } from "effect";

import { Device } from "./device";
import { dropReceiver, pickAndConnect, runDevice } from "./runtime";
import type { ReceiverDevice, VendorCollection } from "./webhid";

const VENDOR: VendorCollection = { usage: 0x92, usagePage: 0xff_1c };

const trackedReceiver = (log: string[]): ReceiverDevice => {
  const state = { opened: false };

  return {
    addEventListener: Function.constVoid,
    close: () => {
      log.push("close");
      state.opened = false;

      return Promise.resolve();
    },
    collections: [VENDOR],
    open: () => {
      log.push("open");
      state.opened = true;

      return Promise.resolve();
    },
    get opened() {
      return state.opened;
    },
    productId: 0xa8_87,
    removeEventListener: Function.constVoid,
    sendReport: () => {
      log.push("send");

      return Promise.resolve();
    },
    vendorId: 0x36_a7,
  };
};

const stubPicker = (receiver: ReceiverDevice) => {
  vi.stubGlobal("navigator", {
    hid: {
      addEventListener: Function.constVoid,
      getDevices: () => Promise.resolve([receiver]),
      removeEventListener: Function.constVoid,
      requestDevice: () => Promise.resolve([receiver]),
    },
  });
};

const repickWhileBusy = (log: string[]) =>
  Effect.gen(function* scenario() {
    const latch = yield* Deferred.make<string>();

    yield* Effect.promise(() => pickAndConnect());

    const old = runDevice(
      Effect.gen(function* holdOldRuntime() {
        yield* Device;
        yield* Deferred.await(latch);
        log.push("old-done");
      })
    );

    yield* Effect.promise(() => sleep(0));

    const repick = pickAndConnect();

    yield* Effect.promise(() => sleep(0));

    const next = runDevice(
      Effect.gen(function* useNewRuntime() {
        yield* Device;
        log.push("new-start");
      })
    );

    yield* Effect.promise(() => sleep(0));

    const midway = [...log];

    yield* Deferred.succeed(latch, "released");
    yield* Effect.promise(() => Promise.all([old, repick, next]));

    return { final: [...log], midway };
  });

describe("receiver runtime re-pick", () => {
  afterEach(async () => {
    await dropReceiver();
    vi.unstubAllGlobals();
  });

  it("a re-pick leaves the new runtime off the device until the old one is disposed", async () => {
    const log: string[] = [];
    stubPicker(trackedReceiver(log));

    const { final, midway } = await Effect.runPromise(repickWhileBusy(log));

    expect(midway).toStrictEqual(["open"]);
    expect(final).toStrictEqual([
      "open",
      "old-done",
      "close",
      "open",
      "new-start",
    ]);
  });
});
