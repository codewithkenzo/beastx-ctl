import { describe, expect, it } from "vitest";

import type { DeviceRead } from "./device";
import type { DpiStage, Settings } from "./fixture";
import {
  applyPatch,
  stagePatch,
  toSettingsPatch,
  toSnapshot,
  toggleStage,
} from "./snapshot";

const read: DeviceRead = {
  battery: { charging: true, percent: 64 },
  display: { mode: 1 },
  profile: 2,
  settings: {
    activeStage: 3,
    debounceMs: 6,
    liftOff: 1,
    motionSync: 0,
    pollingIndex: 4,
    sleepSeconds: 120,
  },
  stages: [
    { colour: [1, 2, 3], enabled: true, x: 800, y: 800 },
    { colour: [1, 2, 3], enabled: true, x: 800, y: 800 },
    { colour: [1, 2, 3], enabled: false, x: 800, y: 800 },
  ],
};

const stage = (enabled: boolean): DpiStage => ({
  colour: [0, 0, 0],
  enabled,
  x: 800,
  y: 800,
});

const table = (...on: boolean[]): readonly DpiStage[] => [
  ...on.map(stage),
  ...Array.from({ length: 8 - on.length }, () => stage(false)),
];

const settingsWith = (
  stages: readonly DpiStage[],
  activeStage = 0
): Settings => ({
  activeStage,
  debounceMs: 4,
  liftOffIndex: 0,
  motionSync: true,
  pollingIndex: 3,
  sleepSeconds: 60,
  stageCount: 1,
  stages,
});

describe(stagePatch, () => {
  it("carries only the fields that changed", () => {
    const before = stage(true);

    expect(stagePatch(2, before, { ...before, x: 1600 })).toStrictEqual({
      index: 2,
      x: 1600,
    });
  });
});

describe(applyPatch, () => {
  it("changes one stage and leaves the others as they were", () => {
    const settings = settingsWith(table(true, true));
    const next = applyPatch(settings, { stage: { index: 1, x: 3200 } });

    expect(next.stages[1]?.x).toBe(3200);
    expect(next.stages[0]).toBe(settings.stages[0]);
    expect(next.stageCount).toBe(1);
  });
});

describe(toSnapshot, () => {
  it("maps a device read onto the online snapshot shape", () => {
    expect(toSnapshot(read)).toStrictEqual({
      battery: { charging: true, percent: 64 },
      display: { mode: 1 },
      link: "online",
      settings: {
        activeStage: 3,
        debounceMs: 6,
        liftOffIndex: 1,
        motionSync: false,
        pollingIndex: 4,
        sleepSeconds: 120,
        stageCount: 2,
        stages: read.stages,
      },
      writeStatus: null,
    });
  });
});

describe(toSettingsPatch, () => {
  it("maps UI names and booleans onto protocol fields", () => {
    expect(
      toSettingsPatch({ liftOffIndex: 0, motionSync: true, pollingIndex: 5 })
    ).toStrictEqual({ liftOff: 0, motionSync: 1, pollingIndex: 5 });
  });

  it("omits fields the UI did not change", () => {
    expect(toSettingsPatch({ debounceMs: 4 })).toStrictEqual({ debounceMs: 4 });
  });

  it("passes one stage edit through as a single-slot patch", () => {
    expect(toSettingsPatch({ stage: { index: 2, x: 1200 } })).toStrictEqual({
      stage: { index: 2, x: 1200 },
    });
  });
});

describe(toggleStage, () => {
  it("turning stage 2 on writes only that stage's enable flag", () => {
    expect(toggleStage(settingsWith(table(true)), 1, true)).toStrictEqual({
      stage: { enable: true, index: 1 },
    });
  });

  it("turning a stage on does not switch on the stages below it", () => {
    expect(toggleStage(settingsWith(table(true)), 3, true)).toStrictEqual({
      stage: { enable: true, index: 3 },
    });
  });

  it("turning the top stage off writes only that stage's flag", () => {
    expect(
      toggleStage(settingsWith(table(true, true, true)), 2, false)
    ).toStrictEqual({ stage: { enable: false, index: 2 } });
  });

  it("turning a middle stage off leaves the stages above it alone", () => {
    expect(
      toggleStage(settingsWith(table(true, true, true, true), 0), 1, false)
    ).toStrictEqual({ stage: { enable: false, index: 1 } });
  });

  it("refuses turning off the last stage that is on", () => {
    expect(toggleStage(settingsWith(table(true)), 0, false)).toBeUndefined();
  });

  it("refuses turning off the active stage", () => {
    expect(
      toggleStage(settingsWith(table(true, true, true, true), 3), 3, false)
    ).toBeUndefined();
  });

  it("refuses a stage index outside the table", () => {
    expect(toggleStage(settingsWith(table(true)), 8, true)).toBeUndefined();
  });
});
