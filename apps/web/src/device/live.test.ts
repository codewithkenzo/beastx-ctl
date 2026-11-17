import { setTimeout as sleep } from "node:timers/promises";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { Deferred, Effect, Function } from "effect";

import { fixtureSnapshot } from "./fixture";
import { watchLive } from "./live";
import { gateQuery, mouseQuery } from "./queries";
import {
  dropReceiver,
  hasReceiver,
  restoreReceiver,
  runDevice,
} from "./runtime";
import type {
  InputReportListener,
  ReceiverDevice,
  VendorCollection,
} from "./webhid";

const VENDOR: VendorCollection = { usage: 0x92, usagePage: 0xff_1c };
const snapshotKey = mouseQuery("device").queryKey;
const gateKey = gateQuery("device").queryKey;
const CLOSED_GATE = { backedUp: false, experimental: false };

interface Status {
  readonly battery:
    | { readonly percent: number; readonly charging: boolean }
    | undefined;
  readonly ready: boolean;
}

type Listener = (event: { readonly device: ReceiverDevice }) => void;

const fakeReceiver = (): ReceiverDevice => ({
  addEventListener: Function.constVoid,
  close: () => Promise.resolve(),
  collections: [VENDOR],
  open: () => Promise.resolve(),
  opened: true,
  productId: 0xa8_87,
  removeEventListener: Function.constVoid,
  sendReport: () => Promise.resolve(),
  vendorId: 0x36_a7,
});

const trackedReceiver = () => {
  const listeners = new Set<InputReportListener>();
  const close = vi.fn<() => Promise<void>>(() => Promise.resolve());

  const receiver: ReceiverDevice = {
    ...fakeReceiver(),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    close,
    opened: false,
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };

  return { close, listeners, receiver };
};

const pairedWith = (receiver: ReceiverDevice) => {
  const listeners = new Map<string, Set<Listener>>();

  const emit = (type: string, device: ReceiverDevice) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ device });
    }
  };

  vi.stubGlobal("navigator", {
    hid: {
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
      },
      getDevices: () => Promise.resolve([receiver]),
      removeEventListener: (type: string, listener: Listener) => {
        listeners.get(type)?.delete(listener);
      },
      requestDevice: () => Promise.resolve([]),
    },
  });

  return { emit };
};

const pickPaired = async () => {
  const receiver = fakeReceiver();

  pairedWith(receiver);
  await restoreReceiver();
};

const page = {
  listeners: new Set<() => void>(),
  visibilityState: "visible" as "hidden" | "visible",
};

const stubPage = () => {
  vi.stubGlobal("document", {
    addEventListener: (_type: string, listener: () => void) => {
      page.listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      page.listeners.delete(listener);
    },
    get visibilityState() {
      return page.visibilityState;
    },
  });
};

const setVisibility = (state: "hidden" | "visible") => {
  page.visibilityState = state;

  for (const listener of page.listeners) {
    listener();
  }
};

const flush = () => sleep(0);

type Source = () => Promise<Status | undefined>;

const idle: Source = () => Promise.resolve(undefined);

describe("live mouse state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    page.visibilityState = "visible";
    stubPage();
  });

  afterEach(async () => {
    await dropReceiver();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    page.listeners.clear();
  });

  it("a status that is not ready shows the asleep state", async () => {
    await pickPaired();
    const client = new QueryClient();
    client.setQueryData(snapshotKey, await fixtureSnapshot("ready"));

    const source = vi.fn<Source>(() =>
      Promise.resolve({ battery: undefined, ready: false })
    );

    const stop = watchLive(client, source);
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(client.getQueryData(snapshotKey)).toStrictEqual({ link: "asleep" });
  });

  it("a ready status after asleep invalidates the snapshot for a full re-read", async () => {
    await pickPaired();
    const client = new QueryClient();
    client.setQueryData(snapshotKey, { link: "asleep" });

    const source = vi.fn<Source>(() =>
      Promise.resolve({
        battery: { charging: false, percent: 80 },
        ready: true,
      })
    );

    const stop = watchLive(client, source);
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(client.getQueryState(snapshotKey)?.isInvalidated).toBeTruthy();
  });

  it("a battery change patches the online snapshot without a re-read", async () => {
    await pickPaired();
    const client = new QueryClient();
    client.setQueryData(snapshotKey, await fixtureSnapshot("ready"));

    const source = vi.fn<Source>(() =>
      Promise.resolve({
        battery: { charging: true, percent: 42 },
        ready: true,
      })
    );

    const stop = watchLive(client, source);
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(client.getQueryData(snapshotKey)).toMatchObject({
      battery: { charging: true, percent: 42 },
      link: "online",
    });
    expect(client.getQueryState(snapshotKey)?.isInvalidated).toBeFalsy();
  });

  it("does not poll while the page is hidden and resumes when visible", async () => {
    await pickPaired();
    const client = new QueryClient();
    page.visibilityState = "hidden";

    const source = vi.fn<Source>(idle);

    const stop = watchLive(client, source);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(source).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(source).toHaveBeenCalledOnce();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(15_000);
    stop();

    expect(source).toHaveBeenCalledOnce();
  });

  it("polls every 5 seconds and stops on cleanup", async () => {
    await pickPaired();
    const client = new QueryClient();

    const source = vi.fn<Source>(idle);

    const stop = watchLive(client, source);
    await vi.advanceTimersByTimeAsync(5000);
    expect(source).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(source).toHaveBeenCalledTimes(2);
  });

  it("polls nothing while no receiver is picked, and starts once one is", async () => {
    const client = new QueryClient();

    const source = vi.fn<Source>(idle);

    const stop = watchLive(client, source);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(source).not.toHaveBeenCalled();

    await pickPaired();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(source).toHaveBeenCalledOnce();
  });

  it("three failed polls in a row show the asleep state", async () => {
    await pickPaired();
    const client = new QueryClient();
    client.setQueryData(snapshotKey, await fixtureSnapshot("ready"));

    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation(Function.constVoid);

    const source = vi.fn<Source>(() => Promise.reject(new Error("timeout")));

    const stop = watchLive(client, source);
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.getQueryData(snapshotKey)).not.toStrictEqual({
      link: "asleep",
    });

    await vi.advanceTimersByTimeAsync(5000);
    stop();
    warn.mockRestore();

    expect(client.getQueryData(snapshotKey)).toStrictEqual({ link: "asleep" });
  });

  it("a disconnect of the picked receiver disposes the runtime and sets none", async () => {
    const receiver = fakeReceiver();
    const events = pairedWith(receiver);
    const client = new QueryClient();
    client.setQueryData(snapshotKey, { link: "asleep" });
    await restoreReceiver();

    const stop = watchLive(client, idle);
    events.emit("disconnect", receiver);

    await vi.waitFor(() => {
      expect(client.getQueryData(snapshotKey)).toStrictEqual({ link: "none" });
    });
    stop();

    expect(hasReceiver()).toBeFalsy();
  });

  it("a disconnect of another HID device leaves the snapshot alone", async () => {
    const receiver = fakeReceiver();
    const events = pairedWith(receiver);
    const client = new QueryClient();
    client.setQueryData(snapshotKey, { link: "asleep" });
    await restoreReceiver();

    const stop = watchLive(client, idle);
    events.emit("disconnect", fakeReceiver());
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(client.getQueryData(snapshotKey)).toStrictEqual({ link: "asleep" });
    expect(hasReceiver()).toBeTruthy();
  });

  it("a connect of the receiver invalidates the snapshot for a full re-read", async () => {
    const receiver = fakeReceiver();
    const events = pairedWith(receiver);
    const client = new QueryClient();
    client.setQueryData(snapshotKey, { link: "asleep" });

    const stop = watchLive(client, idle);
    events.emit("connect", receiver);

    await vi.waitFor(() => {
      expect(client.getQueryState(snapshotKey)?.isInvalidated).toBeTruthy();
    });
    stop();
  });

  it("unplugging the picked receiver closes the gate shown to the screens", async () => {
    const receiver = fakeReceiver();
    const events = pairedWith(receiver);
    const client = new QueryClient();
    client.setQueryData(gateKey, { backedUp: true, experimental: true });
    await restoreReceiver();

    const stop = watchLive(client, idle);
    events.emit("disconnect", receiver);

    await vi.waitFor(() => {
      expect(client.getQueryData(gateKey)).toStrictEqual(CLOSED_GATE);
    });
    stop();
  });

  it("re-picking the receiver closes the gate shown to the screens", async () => {
    const receiver = fakeReceiver();
    pairedWith(receiver);
    const client = new QueryClient();
    client.setQueryData(gateKey, { backedUp: true, experimental: true });
    await restoreReceiver();

    const stop = watchLive(client, idle);
    await dropReceiver();
    await restoreReceiver();
    stop();

    expect(client.getQueryData(gateKey)).toStrictEqual(CLOSED_GATE);
  });

  it("a connect of another receiver closes the gate shown to the screens", async () => {
    const receiver = fakeReceiver();
    const events = pairedWith(receiver);
    const client = new QueryClient();
    client.setQueryData(gateKey, { backedUp: true, experimental: true });
    await restoreReceiver();

    const stop = watchLive(client, idle);
    events.emit("connect", fakeReceiver());

    await vi.waitFor(() => {
      expect(client.getQueryData(gateKey)).toStrictEqual(CLOSED_GATE);
    });
    stop();
  });

  it("a reconnect reads the stored gate back instead of the closed view", async () => {
    const stored = JSON.stringify({
      backedUpAt: "2026-01-01T00:00:00.000Z",
      experimental: true,
    });

    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: () => {},
    });
    const receiver = fakeReceiver();
    const events = pairedWith(receiver);
    const client = new QueryClient();
    await restoreReceiver();

    const observer = new QueryObserver(client, gateQuery("device"));
    const unsubscribe = observer.subscribe(() => {});
    const stop = watchLive(client, idle);
    await vi.waitFor(() => {
      expect(client.getQueryData(gateKey)).toStrictEqual({
        backedUp: true,
        experimental: true,
      });
    });

    events.emit("disconnect", receiver);
    await vi.waitFor(() => {
      expect(client.getQueryData(gateKey)).toStrictEqual(CLOSED_GATE);
    });

    events.emit("connect", receiver);
    await vi.waitFor(() => {
      expect(client.getQueryData(gateKey)).toStrictEqual({
        backedUp: true,
        experimental: true,
      });
    });
    unsubscribe();
    stop();
  });
});

describe("receiver runtime", () => {
  beforeEach(() => {
    page.visibilityState = "visible";
    stubPage();
  });

  afterEach(async () => {
    await dropReceiver();
    vi.unstubAllGlobals();
    page.listeners.clear();
  });

  it("concurrent restores share one runtime and leave one input listener", async () => {
    const { listeners, receiver } = trackedReceiver();
    pairedWith(receiver);

    const results = await Promise.all([restoreReceiver(), restoreReceiver()]);
    await runDevice(Effect.void);

    expect(results).toStrictEqual([true, true]);
    expect(listeners.size).toBe(1);

    await dropReceiver();

    expect(listeners.size).toBe(0);
  });

  it("dropping waits for device work in flight before closing the transport", async () => {
    const { close, receiver } = trackedReceiver();
    pairedWith(receiver);
    await restoreReceiver();

    const latch = await Effect.runPromise(Deferred.make<string>());

    const run = runDevice(Deferred.await(latch));
    const dropped = dropReceiver();
    await flush();

    expect(close).not.toHaveBeenCalled();

    await Effect.runPromise(Deferred.succeed(latch, "done"));

    await expect(run).resolves.toBe("done");
    await dropped;
    expect(close).toHaveBeenCalledOnce();
  });

  it("a connect event for the held receiver keeps its runtime", async () => {
    const { close, listeners, receiver } = trackedReceiver();
    const events = pairedWith(receiver);
    const client = new QueryClient();
    client.setQueryData(snapshotKey, await fixtureSnapshot("ready"));
    await restoreReceiver();
    await runDevice(Effect.void);

    const stop = watchLive(client, idle);
    events.emit("connect", receiver);
    await flush();
    stop();

    expect(close).not.toHaveBeenCalled();
    expect(listeners.size).toBe(1);
    expect(client.getQueryState(snapshotKey)?.isInvalidated).toBeFalsy();
  });
});
