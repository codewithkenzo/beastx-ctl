import { DeviceStatus } from "@beastx-ctl/protocol";
import { toasts } from "@beastx-ctl/ui";
import type { QueryClient } from "@tanstack/react-query";
import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Effect } from "effect";

import { t } from "../copy/t";
import { downloadBackupFile } from "./backup";
import { Device } from "./device";
import type { WriteRead } from "./device";
import { writeNotice } from "./error-copy";
import { fixtureSnapshot, isFixtureState } from "./fixture";
import type { FixtureState, MouseSnapshot } from "./fixture";
import { pickAndConnect, restoreReceiver, runDevice } from "./runtime";
import { applyPatch, readMouse, toSettingsPatch, toSnapshot } from "./snapshot";
import type { WritePatch } from "./snapshot";

export type Source = FixtureState | "device";

const readReceiver = async (): Promise<MouseSnapshot> => {
  if (!(await restoreReceiver())) {
    return { link: "none" };
  }

  return runDevice(readMouse);
};

export const mouseQuery = (source: Source) =>
  queryOptions({
    queryFn: () =>
      source === "device" ? readReceiver() : fixtureSnapshot(source),
    queryKey: ["mouse", "snapshot", source],
    staleTime: Number.POSITIVE_INFINITY,
  });

const deviceKey = mouseQuery("device").queryKey;

interface GateState {
  readonly backedUp: boolean;
  readonly experimental: boolean;
}

const FIXTURE_GATE: GateState = { backedUp: true, experimental: true };

const CLOSED_GATE: GateState = { backedUp: false, experimental: false };

const gateKey = (source: Source) => ["mouse", "gate", source] as const;

const gateFlow = Effect.gen(function* gateBlock() {
  const device = yield* Device;

  return yield* device.gate;
});

const writeSettingFlow = (patch: WritePatch) =>
  Effect.gen(function* writeSettingBlock() {
    const device = yield* Device;
    const settingsPatch = toSettingsPatch(patch);

    return yield* device
      .writeSettings(settingsPatch)
      .pipe(
        Effect.catchTag("ExperimentalOff", (error) =>
          Effect.logWarning(
            "settings write blocked: experimental writes are off"
          ).pipe(Effect.andThen(Effect.fail(error)))
        )
      );
  });

const setExperimentalFlow = (on: boolean) =>
  Effect.gen(function* setExperimentalBlock() {
    const device = yield* Device;

    yield* device.setExperimental(on);
  });

const backupFlow = Effect.gen(function* backupBlock() {
  const device = yield* Device;

  yield* device.backup(downloadBackupFile);
});

const withPatch = (
  prev: MouseSnapshot | undefined,
  patch: WritePatch
): MouseSnapshot | undefined =>
  prev?.link === "online"
    ? { ...prev, settings: applyPatch(prev.settings, patch) }
    : prev;

const withRead = (
  prev: MouseSnapshot | undefined,
  read: WriteRead
): MouseSnapshot | undefined =>
  prev?.link === "online"
    ? toSnapshot({ ...read, battery: prev.battery })
    : prev;

export const settingMutation = (
  client: QueryClient,
  send: (patch: WritePatch) => Promise<WriteRead>
) =>
  mutationOptions({
    mutationFn: send,
    onError: (error, _patch, context) => {
      client.setQueryData(deviceKey, context?.previous);

      if (error instanceof DeviceStatus) {
        client.setQueryData(deviceKey, (prev: MouseSnapshot | undefined) =>
          prev?.link === "online"
            ? { ...prev, writeStatus: error.status }
            : prev
        );

        return;
      }

      const notice = writeNotice(error);

      if (notice !== undefined) {
        toasts.add({ title: t(notice.key, notice.vars), type: "error" });
      }

      client.invalidateQueries({ queryKey: deviceKey });
    },
    onMutate: async (patch: WritePatch) => {
      await client.cancelQueries({ queryKey: deviceKey });

      const previous = client.getQueryData<MouseSnapshot>(deviceKey);

      client.setQueryData(deviceKey, (prev: MouseSnapshot | undefined) =>
        withPatch(prev, patch)
      );

      return { previous };
    },
    onSuccess: (read) =>
      client.setQueryData(deviceKey, (prev: MouseSnapshot | undefined) =>
        withRead(prev, read)
      ),
  });

export const useWriteSetting = (source: Source) => {
  const client = useQueryClient();

  const write = useMutation(
    settingMutation(client, (patch) => runDevice(writeSettingFlow(patch)))
  );

  return (patch: WritePatch): void => {
    if (source === "device") {
      write.mutate(patch);

      return;
    }

    client.setQueryData(
      mouseQuery(source).queryKey,
      (prev: MouseSnapshot | undefined) => withPatch(prev, patch)
    );
  };
};

export const gateQuery = (source: Source) =>
  queryOptions({
    queryFn: () =>
      source === "device" ? runDevice(gateFlow) : Promise.resolve(FIXTURE_GATE),
    queryKey: gateKey(source),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const markBackedUp = (client: QueryClient): void => {
  client.setQueryData(gateKey("device"), (prev: GateState | undefined) =>
    prev === undefined ? undefined : { ...prev, backedUp: true }
  );
};

export const resetGate = (client: QueryClient): void => {
  client.setQueryData(gateKey("device"), CLOSED_GATE);
};

export const reloadGate = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: gateKey("device") });

export const useGate = (source: Source) => useQuery(gateQuery(source));

export const useSetExperimental = (source: Source) => {
  const client = useQueryClient();

  const experimental = useMutation({
    mutationFn: (on: boolean) => runDevice(setExperimentalFlow(on)),
    onSuccess: () => client.invalidateQueries({ queryKey: gateKey("device") }),
  });

  return (on: boolean): void => {
    if (source === "device") {
      experimental.mutate(on);

      return;
    }

    client.setQueryData(gateKey(source), (prev: GateState | undefined) => ({
      ...(prev ?? FIXTURE_GATE),
      experimental: on,
    }));
  };
};

export const usePickReceiver = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => pickAndConnect(),
    onSuccess: () => client.invalidateQueries({ queryKey: deviceKey }),
  });
};

export const useBackup = (source: Source) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (source !== "device") {
        return;
      }

      await runDevice(backupFlow);
    },
    onError: () => {
      toasts.add({ title: t("backup.failed"), type: "error" });
    },
    onSuccess: () => {
      if (source === "device") {
        markBackedUp(client);
      }

      return client.invalidateQueries({ queryKey: gateKey("device") });
    },
  });
};

export const searchState = (search: {
  state?: unknown;
}): { state?: FixtureState } =>
  isFixtureState(search.state) ? { state: search.state } : {};
