import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useEffect } from "react";

import type { DeviceApi } from "./device";
import { Device } from "./device";
import type { MouseSnapshot } from "./fixture";
import { mouseQuery, reloadGate, resetGate } from "./queries";
import {
  dropReceiver,
  hasReceiver,
  holdsReceiver,
  onConnected,
  releaseReceiver,
  restoreReceiver,
  runDevice,
} from "./runtime";
import { watchReceivers } from "./webhid";
import type { ReceiverDevice } from "./webhid";

type LinkStatus = Effect.Success<DeviceApi["status"]>;

type StatusSource = () => Promise<LinkStatus | undefined>;

const POLL_MS = 5000;

const STUCK_AFTER_FAILURES = 3;

const snapshotKey = mouseQuery("device").queryKey;

const readStatus = Effect.gen(function* readStatusBlock() {
  const device = yield* Device;

  return yield* device.status;
});

const pollPicked: StatusSource = () =>
  hasReceiver() ? runDevice(readStatus) : Promise.resolve(undefined);

const isVisible = (): boolean => document.visibilityState === "visible";

const applyStatus = (client: QueryClient, status: LinkStatus): void => {
  if (!status.ready) {
    client.setQueryData(snapshotKey, { link: "asleep" });

    return;
  }

  const cached = client.getQueryData(snapshotKey);

  if (cached?.link === "asleep") {
    if (client.isFetching({ queryKey: snapshotKey }) === 0) {
      void client.invalidateQueries({ queryKey: snapshotKey });
    }

    return;
  }

  const { battery } = status;

  if (
    cached === undefined ||
    cached.link !== "online" ||
    battery === undefined
  ) {
    return;
  }

  const unchanged =
    cached.battery.percent === battery.percent &&
    cached.battery.charging === battery.charging;

  if (unchanged) {
    return;
  }

  const next: MouseSnapshot = {
    ...cached,
    battery: { charging: battery.charging, percent: battery.percent },
  };

  client.setQueryData(snapshotKey, next);
};

export const watchLive = (
  client: QueryClient,
  source: StatusSource = pollPicked
): (() => void) => {
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  let failures = 0;

  const stop = (): void => {
    clearInterval(timer);
    timer = undefined;
  };

  const poll = async (): Promise<void> => {
    try {
      const status = await source();

      if (status !== undefined) {
        failures = 0;
        applyStatus(client, status);
      }
    } catch (error) {
      failures += 1;
      console.warn("device status poll failed", error);

      if (failures >= STUCK_AFTER_FAILURES) {
        client.setQueryData(snapshotKey, { link: "asleep" });
      }
    } finally {
      inFlight = false;
    }
  };

  const tick = (): void => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    void poll();
  };

  const start = (): void => {
    if (timer !== undefined || !isVisible() || !hasReceiver()) {
      return;
    }

    failures = 0;
    tick();
    timer = setInterval(tick, POLL_MS);
  };

  const onVisibility = (): void => {
    if (isVisible()) {
      start();

      return;
    }

    stop();
  };

  const reconnect = async (device: ReceiverDevice): Promise<void> => {
    if (holdsReceiver(device)) {
      return;
    }

    stop();
    await dropReceiver();
    resetGate(client);
    await restoreReceiver();
    await client.invalidateQueries({ queryKey: snapshotKey });
  };

  const unlink = async (device: ReceiverDevice): Promise<void> => {
    if (await releaseReceiver(device)) {
      stop();
      resetGate(client);
      client.setQueryData(snapshotKey, { link: "none" });
    }
  };

  const unwatchReceivers = watchReceivers({
    onConnect: (device) => {
      void reconnect(device);
    },
    onDisconnect: (device) => {
      void unlink(device);
    },
  });

  const unlistenConnected = onConnected(() => {
    resetGate(client);
    void reloadGate(client);
    start();
  });

  document.addEventListener("visibilitychange", onVisibility);
  start();

  return () => {
    unwatchReceivers();
    unlistenConnected();
    document.removeEventListener("visibilitychange", onVisibility);
    stop();
  };
};

export const useLiveReceiver = (): void => {
  const client = useQueryClient();

  useEffect(() => watchLive(client), [client]);
};
