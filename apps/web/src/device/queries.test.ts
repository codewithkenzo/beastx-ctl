import { setTimeout as sleep } from "node:timers/promises";

import { crc16Modbus } from "@beastx-ctl/protocol";
import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { Effect, Layer, ManagedRuntime, Queue } from "effect";
import { describe, expect, it } from "vitest";

import { Device } from "./device";
import type { WriteRead } from "./device";
import { fixtureSnapshot } from "./fixture";
import type { MouseSnapshot } from "./fixture";
import { GateStore } from "./gate-store";
import {
  gateQuery,
  markBackedUp,
  mouseQuery,
  settingMutation,
} from "./queries";
import { readMouse, toSettingsPatch, toSnapshot } from "./snapshot";
import { Transport } from "./transport";

const CONFIG_LEN = 117;
const CMD_INDEX = 3;

const replyFrame = (
  cmd: number,
  address: number,
  data: readonly number[]
): Uint8Array => {
  const frame = new Uint8Array(64);

  frame[0] = 0x04;
  frame[3] = cmd;
  frame[4] = data.length;

  new DataView(frame.buffer).setUint16(5, address, true);
  frame.set(data, 8);

  const crc = crc16Modbus(frame.subarray(3, 32));

  frame[1] = crc % 256;
  frame[2] = Math.floor(crc / 256);

  return frame;
};

const configBlock = (): Uint8Array => {
  const block = new Uint8Array(CONFIG_LEN);

  block[11] = 3;
  block[14] = 1;
  block[86] = 0x3c;
  block[90] = 4;
  block[92] = 1;

  return block;
};

const addressOf = (frame: Uint8Array): number =>
  new DataView(frame.buffer, frame.byteOffset).getUint16(5, true);

const repliesFor = (frame: Uint8Array, block: Uint8Array): Uint8Array[] => {
  const cmd = frame.at(CMD_INDEX);
  const address = addressOf(frame);

  if (cmd === 0xaa) {
    return [replyFrame(0xaa, 0, [0xff])];
  }

  if (cmd === 0x1a) {
    return [replyFrame(0x1a, 0, [72, 0, 0, 0, 0, 0])];
  }

  if (cmd === 0x05 && address === 0) {
    return [replyFrame(0x05, 0, [0])];
  }

  if (cmd === 0x05) {
    const chunk = block.subarray(address, address + 24);

    return [replyFrame(0x05, address, [...chunk])];
  }

  if (cmd === 0x35) {
    return [
      replyFrame(
        0x35,
        address,
        Array.from({ length: 13 }, () => 0)
      ),
    ];
  }

  return [];
};

const readOnline = Effect.gen(function* readOnline() {
  const inbox = yield* Queue.unbounded<Uint8Array>();
  const block = configBlock();

  const transport = Layer.succeed(Transport, {
    clear: Queue.clear(inbox),
    receive: Queue.take(inbox),
    send: (frame: Uint8Array) =>
      Effect.sync(() => {
        for (const reply of repliesFor(frame, block)) {
          Queue.offerUnsafe(inbox, reply);
        }
      }),
  });

  return yield* Effect.gen(function* readDevice() {
    const device = yield* Device;

    return yield* device.read;
  }).pipe(
    Effect.provide(
      Device.layer.pipe(
        Layer.provide(Layer.merge(transport, GateStore.memory()))
      )
    )
  );
});

describe("device read", () => {
  it("decodes the battery reply into the online snapshot", async () => {
    const device = await Effect.runPromise(readOnline);

    expect(device.battery.percent).toBe(72);
    expect(toSnapshot(device).link).toBe("online");
  });

  it("shows the asleep state when the ping gets no reply", async () => {
    const snapshot = await Effect.runPromise(
      Effect.gen(function* readSilentMouse() {
        const inbox = yield* Queue.unbounded<Uint8Array>();

        const transport = Layer.succeed(Transport, {
          clear: Queue.clear(inbox),
          receive: Queue.take(inbox),
          send: () => Effect.void,
        });

        return yield* readMouse.pipe(
          Effect.provide(
            Device.layer.pipe(
              Layer.provide(Layer.merge(transport, GateStore.memory()))
            )
          )
        );
      })
    );

    expect(snapshot).toStrictEqual({ link: "asleep" });
  });

  it("shows the asleep state when the ping reply is not ready", async () => {
    const snapshot = await Effect.runPromise(
      Effect.gen(function* readNotReadyMouse() {
        const inbox = yield* Queue.unbounded<Uint8Array>();

        const transport = Layer.succeed(Transport, {
          clear: Queue.clear(inbox),
          receive: Queue.take(inbox),
          send: () => Queue.offer(inbox, replyFrame(0xaa, 0, [0x00])),
        });

        return yield* readMouse.pipe(
          Effect.provide(
            Device.layer.pipe(
              Layer.provide(Layer.merge(transport, GateStore.memory()))
            )
          )
        );
      })
    );

    expect(snapshot).toStrictEqual({ link: "asleep" });
  });
});

const answerWrite = (frame: Uint8Array, block: Uint8Array): Uint8Array[] => {
  const address = addressOf(frame);
  const length = frame[4] ?? 0;

  if (frame.at(CMD_INDEX) === 0x06) {
    block.set(frame.subarray(8, 8 + length), address);

    return [replyFrame(0x06, address, [])];
  }

  if (frame.at(CMD_INDEX) === 0x05 && length === 1) {
    return [replyFrame(0x05, 0, [0])];
  }

  if (frame.at(CMD_INDEX) === 0x05) {
    return [
      replyFrame(0x05, address, [...block.subarray(address, address + length)]),
    ];
  }

  return repliesFor(frame, block);
};

const pollingOf = (snapshot: MouseSnapshot | undefined): number | undefined =>
  snapshot?.link === "online" ? snapshot.settings.pollingIndex : undefined;

const readBack = (pollingIndex: number): WriteRead => ({
  display: { mode: 0 },
  profile: 0,
  settings: {
    activeStage: 0,
    debounceMs: 4,
    liftOff: 0,
    motionSync: 1,
    pollingIndex,
    sleepSeconds: 60,
  },
  stages: [],
});

describe("setting write", () => {
  const ready = fixtureSnapshot("ready");
  const readyPolling = pollingOf(ready);
  const nextPolling = ((readyPolling ?? 0) + 1) % 6;

  it("shows the new value while the write runs and keeps it on success", async () => {
    const client = new QueryClient();
    client.setQueryData(mouseQuery("device").queryKey, ready);

    const observer = new MutationObserver(
      client,
      settingMutation(client, () => sleep(50).then(() => readBack(nextPolling)))
    );

    const done = observer.mutate({ pollingIndex: nextPolling });
    await sleep(0);

    expect(pollingOf(client.getQueryData(mouseQuery("device").queryKey))).toBe(
      nextPolling
    );

    await done;

    expect(pollingOf(client.getQueryData(mouseQuery("device").queryKey))).toBe(
      nextPolling
    );

    client.clear();
  });

  it("takes the device's read-back on success and does not re-read", async () => {
    const client = new QueryClient();
    const key = mouseQuery("device").queryKey;
    const deviceSaid = (nextPolling + 1) % 6;

    client.setQueryData(key, ready);

    const observer = new MutationObserver(
      client,
      settingMutation(client, () => Promise.resolve(readBack(deviceSaid)))
    );

    await observer.mutate({ pollingIndex: nextPolling });

    expect(pollingOf(client.getQueryData(key))).toBe(deviceSaid);
    expect(client.getQueryState(key)?.isInvalidated).toBeFalsy();

    client.clear();
  });

  it("rolls back to the previous snapshot when the write fails", async () => {
    const client = new QueryClient();
    client.setQueryData(mouseQuery("device").queryKey, ready);

    const observer = new MutationObserver(
      client,
      settingMutation(client, () => Promise.reject(new Error("boom")))
    );

    await expect(
      observer.mutate({ pollingIndex: nextPolling })
    ).rejects.toThrow("boom");

    expect(pollingOf(client.getQueryData(mouseQuery("device").queryKey))).toBe(
      readyPolling
    );

    client.clear();
  });

  it("sends no ping or battery read after a successful write", async () => {
    const block = configBlock();
    const sent: Uint8Array[] = [];
    const inbox = Effect.runSync(Queue.unbounded<Uint8Array>());

    const transport = Layer.succeed(Transport, {
      clear: Queue.clear(inbox),
      receive: Queue.take(inbox),
      send: (frame: Uint8Array) =>
        Effect.sync(() => {
          sent.push(frame);

          for (const reply of answerWrite(frame, block)) {
            Queue.offerUnsafe(inbox, reply);
          }
        }),
    });

    const runtime = ManagedRuntime.make(
      Device.layer.pipe(
        Layer.provide(Layer.merge(transport, GateStore.memory()))
      )
    );

    const client = new QueryClient();
    client.setQueryData(mouseQuery("device").queryKey, ready);

    await runtime.runPromise(
      Effect.gen(function* backupFirst() {
        const api = yield* Device;
        yield* api.backup(() => Effect.void);
      })
    );

    const sentBefore = sent.length;

    const observer = new MutationObserver(
      client,
      settingMutation(client, (patch) =>
        runtime.runPromise(
          Effect.gen(function* writePatch() {
            const api = yield* Device;

            return yield* api.writeSettings(toSettingsPatch(patch));
          })
        )
      )
    );

    await observer.mutate({ pollingIndex: nextPolling });

    const commands = sent.slice(sentBefore).map((frame) => frame.at(CMD_INDEX));
    const key = mouseQuery("device").queryKey;

    expect(commands).toContain(0x06);
    expect(
      commands.filter((cmd) => cmd === 0xaa || cmd === 0x1a)
    ).toStrictEqual([]);
    expect(pollingOf(client.getQueryData(key))).toBe(nextPolling);
    expect(client.getQueryState(key)?.isInvalidated).toBeFalsy();

    await runtime.dispose();
    client.clear();
  });
});

describe("gate after backup", () => {
  it("re-renders every gate consumer with backedUp true", () => {
    const client = new QueryClient();
    const gate = gateQuery("device");

    client.setQueryData(gate.queryKey, {
      backedUp: false,
      experimental: true,
    });

    const first = new QueryObserver(client, gate);
    const second = new QueryObserver(client, gate);
    const seen: (boolean | undefined)[] = [];

    first.subscribe((result) => seen.push(result.data?.backedUp));
    second.subscribe((result) => seen.push(result.data?.backedUp));

    expect(second.getCurrentResult().data?.backedUp).toBeFalsy();

    markBackedUp(client);

    expect(first.getCurrentResult().data?.backedUp).toBeTruthy();
    expect(second.getCurrentResult().data?.backedUp).toBeTruthy();
    expect(seen.at(-1)).toBeTruthy();

    first.destroy();
    second.destroy();
  });
});
