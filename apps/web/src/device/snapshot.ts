import { Command } from "@beastx-ctl/protocol";
import type { SettingsPatch, StagePatch } from "@beastx-ctl/protocol";
import { Effect } from "effect";

import { Device } from "./device";
import type { DeviceRead } from "./device";
import type { DpiStage, MouseSnapshot, Settings } from "./fixture";

type ScalarSettings = Omit<Partial<Settings>, "stageCount" | "stages">;

export type WritePatch = ScalarSettings & { readonly stage?: StagePatch };

export const stagePatch = (
  index: number,
  before: DpiStage,
  after: DpiStage
): StagePatch => ({
  index,
  ...(after.x !== before.x && { x: after.x }),
  ...(after.y !== before.y && { y: after.y }),
  ...(after.colour.some((c, i) => c !== before.colour[i]) && {
    rgb: after.colour,
  }),
});

export const applyPatch = (settings: Settings, patch: WritePatch): Settings => {
  const { stage, ...scalars } = patch;

  return {
    ...settings,
    ...scalars,
    stages:
      stage === undefined
        ? settings.stages
        : settings.stages.map((s, i) =>
            i === stage.index
              ? {
                  colour: stage.rgb ?? s.colour,
                  enabled: stage.enable ?? s.enabled,
                  x: stage.x ?? s.x,
                  y: stage.y ?? s.y,
                }
              : s
          ),
  };
};

const stageCountOf = (stages: readonly DpiStage[]): number =>
  Math.max(stages.findLastIndex((stage) => stage.enabled) + 1, 1);

const enabledCount = (stages: readonly DpiStage[]): number =>
  stages.filter((stage) => stage.enabled).length;

export const toggleStage = (
  settings: Settings,
  index: number,
  on: boolean
): WritePatch | undefined => {
  const target = settings.stages[index];

  if (target === undefined) {
    return undefined;
  }

  if (!on && target.enabled) {
    if (index === settings.activeStage) {
      return undefined;
    }

    if (enabledCount(settings.stages) <= 1) {
      return undefined;
    }
  }

  return { stage: { enable: on, index } };
};

export const toSnapshot = (read: DeviceRead): MouseSnapshot => ({
  battery: read.battery,
  display: read.display,
  link: "online",
  settings: {
    activeStage: read.settings.activeStage,
    debounceMs: read.settings.debounceMs,
    liftOffIndex: read.settings.liftOff,
    motionSync: read.settings.motionSync === 1,
    pollingIndex: read.settings.pollingIndex,
    sleepSeconds: read.settings.sleepSeconds,
    stageCount: stageCountOf(read.stages),
    stages: read.stages,
  },
  writeStatus: null,
});

export const toSettingsPatch = (patch: WritePatch): SettingsPatch => ({
  ...(patch.activeStage !== undefined && { activeStage: patch.activeStage }),
  ...(patch.debounceMs !== undefined && { debounceMs: patch.debounceMs }),
  ...(patch.liftOffIndex !== undefined && { liftOff: patch.liftOffIndex }),
  ...(patch.motionSync !== undefined && {
    motionSync: patch.motionSync ? 1 : 0,
  }),
  ...(patch.pollingIndex !== undefined && { pollingIndex: patch.pollingIndex }),
  ...(patch.sleepSeconds !== undefined && { sleepSeconds: patch.sleepSeconds }),
  ...(patch.stage !== undefined && { stage: patch.stage }),
});

export const readMouse = Effect.gen(function* readMouseBlock() {
  const device = yield* Device;
  const read = yield* device.read;

  return toSnapshot(read);
}).pipe(
  Effect.catchTag("Timeout", (timeout) =>
    timeout.cmd === Command.Ping
      ? Effect.succeed<MouseSnapshot>({ link: "asleep" })
      : Effect.fail(timeout)
  ),
  Effect.catchTag("NotReady", () =>
    Effect.succeed<MouseSnapshot>({ link: "asleep" })
  )
);
