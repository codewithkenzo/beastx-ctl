import { DeviceStatus } from "@beastx-ctl/protocol";
import type { DisplayPatch } from "@beastx-ctl/protocol";
import { toasts } from "@beastx-ctl/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import type { MessageKey } from "../copy/messages";
import { t } from "../copy/t";
import { Device } from "./device";
import { writeNotice } from "./error-copy";
import type { MouseSnapshot } from "./fixture";
import type { Source } from "./queries";
import { mouseQuery } from "./queries";
import { runDevice } from "./runtime";

export const displayModes = [
  { key: "display.mode.default", mode: 0 },
  { key: "display.mode.custom", mode: 1 },
] as const satisfies readonly { key: MessageKey; mode: number }[];

export const displayPatchFor = (value: string): DisplayPatch | undefined => {
  const hit = displayModes.find(({ mode }) => String(mode) === value);

  return hit === undefined ? undefined : { mode: hit.mode };
};

const writeDisplayFlow = (patch: DisplayPatch) =>
  Effect.gen(function* writeDisplayBlock() {
    const device = yield* Device;

    return yield* device.writeDisplay(patch);
  });

const hexByte = (value: number) => `0x${value.toString(16).padStart(2, "0")}`;

export const useWriteDisplay = (source: Source) => {
  const client = useQueryClient();
  const deviceKey = mouseQuery("device").queryKey;

  const write = useMutation({
    mutationFn: (patch: DisplayPatch) => runDevice(writeDisplayFlow(patch)),
    onError: (error) => {
      if (error instanceof DeviceStatus) {
        toasts.add({
          title: t("write.error", { status: hexByte(error.status) }),
          type: "error",
        });
      } else {
        const notice = writeNotice(error);

        if (notice !== undefined) {
          toasts.add({ title: t(notice.key, notice.vars), type: "error" });
        }
      }

      client.invalidateQueries({ queryKey: deviceKey });
    },
    onSuccess: (display) => {
      client.setQueryData(deviceKey, (prev: MouseSnapshot | undefined) =>
        prev?.link === "online"
          ? { ...prev, display: { mode: display.mode } }
          : prev
      );
    },
  });

  return (patch: DisplayPatch): void => {
    if (source === "device") {
      write.mutate(patch);

      return;
    }

    client.setQueryData(
      mouseQuery(source).queryKey,
      (prev: MouseSnapshot | undefined) =>
        prev?.link === "online"
          ? { ...prev, display: { mode: patch.mode ?? prev.display.mode } }
          : prev
    );
  };
};
