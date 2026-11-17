import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Effect, Function, Option } from "effect";

import { Transport } from "./transport";
import type {
  InputReportListener,
  ReceiverDevice,
  VendorCollection,
} from "./webhid";
import {
  NoVendorCollection,
  NotPicked,
  pairedReceiver,
  pickReceiver,
  RECEIVER_FILTER,
  watchReceivers,
  webHidTransport,
} from "./webhid";

type ConnectionListener = (event: { readonly device: ReceiverDevice }) => void;

const VENDOR: VendorCollection = { usage: 0x92, usagePage: 0xff_1c };
const OTHER: VendorCollection = { usage: 0x06, usagePage: 0x01 };

interface FakeOptions {
  readonly collections?: readonly VendorCollection[];
  readonly opened?: boolean;
}

const fakeReceiver = (options: FakeOptions = {}) => {
  const listeners = new Set<InputReportListener>();

  const state = {
    closed: false,
    opened: options.opened ?? true,
    sent: [] as { reportId: number; data: Uint8Array }[],
  };

  const device: ReceiverDevice = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },

    close: () => {
      state.closed = true;

      return Promise.resolve();
    },

    collections: options.collections ?? [VENDOR],

    open: () => {
      state.opened = true;

      return Promise.resolve();
    },

    get opened() {
      return state.opened;
    },

    productId: 0xa8_87,

    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },

    sendReport: (reportId, data) => {
      state.sent.push({ data, reportId });

      return Promise.resolve();
    },

    vendorId: 0x36_a7,
  };

  const emit = (reportId: number, payload: readonly number[]) => {
    const event = {
      data: new DataView(Uint8Array.from(payload).buffer),
      reportId,
    };

    for (const listener of listeners) {
      listener(event);
    }
  };

  return { device, emit, listenerCount: () => listeners.size, state };
};

const stubHid = (hid: {
  readonly getDevices?: () => Promise<readonly ReceiverDevice[]>;
  readonly requestDevice?: (options: {
    readonly filters: readonly (typeof RECEIVER_FILTER)[];
  }) => Promise<readonly ReceiverDevice[]>;
}) => {
  vi.stubGlobal("navigator", {
    hid: {
      getDevices: () => Promise.resolve([]),
      requestDevice: () => Promise.resolve([]),
      ...hid,
    },
  });
};

describe("web hid transport", () => {
  it("send strips the report ID and writes 63 bytes as report 4", async () => {
    const fake = fakeReceiver();
    const frame = new Uint8Array(64);
    frame[0] = 4;
    frame[1] = 0x11;
    frame[2] = 0x22;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* sendStripsReportId() {
          const transport = yield* Transport;
          yield* transport.send(frame);
        }).pipe(Effect.provide(webHidTransport(fake.device)))
      )
    );

    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.sent[0]?.reportId).toBe(4);
    expect(fake.state.sent[0]?.data).toHaveLength(63);
    expect(fake.state.sent[0]?.data.slice(0, 2)).toStrictEqual(
      new Uint8Array([0x11, 0x22])
    );
  });

  it("rebuilds report 4 into a 64-byte frame and ignores other report IDs", async () => {
    const fake = fakeReceiver();

    const reply = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* rebuildsFrame() {
          const transport = yield* Transport;
          fake.emit(1, [0xaa, 0xbb]);
          fake.emit(4, [0x01, 0x02]);

          return yield* transport.receive;
        }).pipe(Effect.provide(webHidTransport(fake.device)))
      )
    );

    expect(reply).toHaveLength(64);
    expect(reply[0]).toBe(4);
    expect(reply[1]).toBe(1);
    expect(reply[2]).toBe(2);
  });

  it("clear drops reports queued before it", async () => {
    const fake = fakeReceiver();

    const reply = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* clearsQueue() {
          const transport = yield* Transport;
          fake.emit(4, [0x01]);
          fake.emit(4, [0x02]);
          yield* transport.clear;
          fake.emit(4, [0x03]);

          return yield* transport.receive;
        }).pipe(Effect.provide(webHidTransport(fake.device)))
      )
    );

    expect(reply[1]).toBe(3);
  });

  it("opens a closed device and releases it when the scope ends", async () => {
    const fake = fakeReceiver({ opened: false });

    const during = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* opensDevice() {
          yield* Transport;

          return { listeners: fake.listenerCount(), opened: fake.state.opened };
        }).pipe(Effect.provide(webHidTransport(fake.device)))
      )
    );

    expect(during).toStrictEqual({ listeners: 1, opened: true });
    expect(fake.state.closed).toBeTruthy();
    expect(fake.listenerCount()).toBe(0);
  });

  it("leaves a device it did not open open when the scope ends", async () => {
    const fake = fakeReceiver({ opened: true });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* keepsDeviceOpen() {
          yield* Transport;
        }).pipe(Effect.provide(webHidTransport(fake.device)))
      )
    );

    expect(fake.state.closed).toBeFalsy();
  });

  it("refuses frames that are not 64 bytes with report ID 4", async () => {
    const fake = fakeReceiver();

    const errors = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* refusesFrames() {
          const transport = yield* Transport;
          const short = yield* Effect.flip(transport.send(new Uint8Array(63)));

          const wrongId = yield* Effect.flip(
            transport.send(new Uint8Array(64).fill(1, 0, 1))
          );

          return [short, wrongId];
        }).pipe(Effect.provide(webHidTransport(fake.device)))
      )
    );

    expect(errors.map((error) => error._tag)).toStrictEqual([
      "TransportError",
      "TransportError",
    ]);
    expect(fake.state.sent).toHaveLength(0);
  });
});

describe("receiver connection events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports only the receiver and stops after unsubscribe", () => {
    const receiver = fakeReceiver().device;
    const other = fakeReceiver({ collections: [OTHER] }).device;
    const listeners = new Set<ConnectionListener>();

    vi.stubGlobal("navigator", {
      hid: {
        addEventListener: (_type: string, listener: ConnectionListener) => {
          listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: ConnectionListener) => {
          listeners.delete(listener);
        },
      },
    });

    const connected: ReceiverDevice[] = [];

    const stop = watchReceivers({
      onConnect: (device) => {
        connected.push(device);
      },
      onDisconnect: Function.constVoid,
    });

    const emitConnect = (device: ReceiverDevice) => {
      for (const listener of listeners) {
        listener({ device });
      }
    };

    emitConnect(other);
    emitConnect(receiver);
    stop();
    emitConnect(receiver);

    expect(connected).toStrictEqual([receiver]);
    expect(listeners.size).toBe(0);
  });
});

describe("receiver discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pickReceiver fails with NotPicked when the chooser is cancelled", async () => {
    stubHid({
      requestDevice: () =>
        Promise.reject(new DOMException("cancelled", "NotAllowedError")),
    });

    const error = await Effect.runPromise(Effect.flip(pickReceiver));

    expect(error).toBeInstanceOf(NotPicked);
  });

  it("pickReceiver filters the chooser to the receiver and fails with NoVendorCollection on the wrong collection", async () => {
    const wrong = fakeReceiver({ collections: [OTHER] });

    const requests: {
      readonly filters: readonly (typeof RECEIVER_FILTER)[];
    }[] = [];

    stubHid({
      requestDevice: (options) => {
        requests.push(options);

        return Promise.resolve([wrong.device]);
      },
    });

    const error = await Effect.runPromise(Effect.flip(pickReceiver));

    expect(requests).toStrictEqual([{ filters: [RECEIVER_FILTER] }]);
    expect(error).toBeInstanceOf(NoVendorCollection);
  });

  it("pickReceiver returns the interface with the vendor collection when the chooser grants several", async () => {
    const mouseInterface = fakeReceiver({ collections: [OTHER] });
    const receiver = fakeReceiver();
    stubHid({
      requestDevice: () =>
        Promise.resolve([mouseInterface.device, receiver.device]),
    });

    const device = await Effect.runPromise(pickReceiver);

    expect(device).toBe(receiver.device);
  });

  it("pairedReceiver returns the receiver that has the vendor collection", async () => {
    const keyboardOnly = fakeReceiver({ collections: [OTHER] });
    const receiver = fakeReceiver();
    stubHid({
      getDevices: () => Promise.resolve([keyboardOnly.device, receiver.device]),
    });

    const found = await Effect.runPromise(pairedReceiver);

    expect(Option.getOrUndefined(found)).toBe(receiver.device);
  });
});
