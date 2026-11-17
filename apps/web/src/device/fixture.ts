const fixtureStates = [
  "empty",
  "reading",
  "ready",
  "asleep",
  "write-error",
  "charging",
] as const;

export type FixtureState = (typeof fixtureStates)[number];

export type Rgb = readonly [number, number, number];

export interface DpiStage {
  enabled: boolean;
  x: number;
  y: number;
  colour: Rgb;
}

export interface Settings {
  pollingIndex: number;
  liftOffIndex: number;
  sleepSeconds: number;
  debounceMs: number;
  motionSync: boolean;
  activeStage: number;
  stageCount: number;
  stages: readonly DpiStage[];
}

interface Battery {
  percent: number;
  charging: boolean;
}

export type MouseSnapshot =
  | { link: "none" }
  | { link: "reading"; done: number; total: number }
  | { link: "asleep" }
  | {
      link: "online";
      battery: Battery;
      display: { mode: number };
      settings: Settings;
      writeStatus: number | null;
    };

export const receiverId = "36a7:a887";
export const configBytes = 117;
export const displayBytes = 13;
export const pollingHz = [125, 250, 500, 1000, 2000, 4000] as const;
export const liftOffMm = [1, 2] as const;
export const sleepSeconds = [30, 60, 300] as const;
export const debounceMs = Array.from({ length: 13 }, (_, i) => i);
export const dpiRange = { max: 26_000, min: 50, step: 50 } as const;

const defaultStageDpi = [1600, 800, 1200, 2400, 3200, 6400, 12_800, 26_000];

const settings: Settings = {
  activeStage: 0,
  debounceMs: 4,
  liftOffIndex: 0,
  motionSync: true,
  pollingIndex: 3,
  sleepSeconds: 60,
  stageCount: 1,
  stages: defaultStageDpi.map((dpi, i) => ({
    colour: i === 0 ? [0x10, 0x00, 0xc8] : [0x00, 0x00, 0x00],
    enabled: i === 0,
    x: dpi,
    y: dpi,
  })),
};

const battery = { charging: false, percent: 72 };

const display = { mode: 0 };

const snapshots: Record<FixtureState, MouseSnapshot> = {
  asleep: { link: "asleep" },
  charging: {
    battery: { ...battery, charging: true },
    display,
    link: "online",
    settings,
    writeStatus: null,
  },
  empty: { link: "none" },
  reading: { done: 3, link: "reading", total: 8 },
  ready: { battery, display, link: "online", settings, writeStatus: null },
  "write-error": {
    battery,
    display,
    link: "online",
    settings,
    writeStatus: 0xff,
  },
};

export const fixtureSnapshot = (state: FixtureState): MouseSnapshot =>
  snapshots[state];

export const isFixtureState = (value: unknown): value is FixtureState =>
  fixtureStates.some((s) => s === value);
