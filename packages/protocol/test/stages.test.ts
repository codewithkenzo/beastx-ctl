import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { writeConfigPatch } from "../src/index";
import type { SettingsPatch } from "../src/index";
import { addressOf, applyFrames, changedBytes, hex, tagOf } from "./helpers";

interface Stage {
  readonly colour: readonly [number, number, number];
  readonly enabled: boolean;
  readonly x: number;
  readonly y: number;
}

const CONFIG_LEN = 117;
const STAGE_COUNT_AT = 9;
const ACTIVE_AT = 12;
const STAGES_START = 14;
const STAGE_STRIDE = 9;

const stage = (
  enabled: boolean,
  x: number,
  y: number,
  colour: readonly [number, number, number]
): Stage => ({ colour, enabled, x, y });

const validStages = (): Stage[] =>
  Array.from({ length: 8 }, () => stage(false, 50, 50, [0, 0, 0]));

const blockWith = (stages: readonly Stage[]): Uint8Array => {
  const block = new Uint8Array(CONFIG_LEN);
  const view = new DataView(block.buffer);
  block[STAGE_COUNT_AT] = 1;

  for (const [slot, value] of stages.entries()) {
    const at = STAGES_START + slot * STAGE_STRIDE;

    block[at] = value.enabled ? 1 : 0;
    view.setUint16(at + 2, value.x, true);
    view.setUint16(at + 4, value.y, true);
    block.set(value.colour, at + 6);
  }

  return block;
};

const writeStages = (base: Uint8Array, patch: SettingsPatch): Uint8Array =>
  applyFrames(base, Result.getOrThrow(writeConfigPatch(0, base, patch)).frames);

describe("DPI stage encoding", () => {
  it("writes one stage as the captured record bytes", () => {
    const applied = writeStages(blockWith(validStages()), {
      stage: {
        enable: true,
        index: 0,
        rgb: [0x10, 0x00, 0xc8],
        x: 1600,
        y: 1600,
      },
    });

    expect(hex(applied.subarray(14, 23))).toBe("01 00 40 06 40 06 10 00 c8");
  });

  it("sends only the chunks a colour change touches", () => {
    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, blockWith(validStages()), {
        stage: { index: 3, rgb: [1, 2, 3] },
      })
    );

    expect(frames.map(addressOf)).toStrictEqual([24, 48]);
  });

  it("never writes block[9] or the active stage for a stage edit", () => {
    const base = blockWith(validStages());

    const applied = writeStages(base, {
      stage: { enable: true, index: 2, x: 400 },
    });

    expect(applied[STAGE_COUNT_AT]).toBe(1);
    expect(applied[ACTIVE_AT]).toBe(base[ACTIVE_AT]);
  });

  it("changes only the edited stage's bytes, never its XY-linked byte", () => {
    const base = blockWith(validStages());

    for (let i = 0; i < CONFIG_LEN; i += 1) {
      base[i] = ((base[i] ?? 0) + ((i * 7) % 251)) % 256;
    }

    const applied = writeStages(base, {
      stage: { enable: true, index: 2, rgb: [1, 2, 3], x: 100, y: 200 },
    });

    const stageTwo = STAGES_START + 2 * STAGE_STRIDE;
    const differing = changedBytes(base, applied);

    expect(
      differing.every((i) => i >= stageTwo && i < stageTwo + STAGE_STRIDE)
    ).toBeTruthy();
    expect(differing).not.toContain(stageTwo + 1);
  });
});

describe("DPI stage validation", () => {
  it.each([0, 49, 1625, 26_050])("refuses DPI %s on X", (dpi) => {
    expect(
      tagOf(
        writeConfigPatch(0, blockWith(validStages()), {
          stage: { index: 0, x: dpi },
        })
      )
    ).toBe("UnsupportedValue");
  });

  it("refuses a colour channel above 255", () => {
    expect(
      tagOf(
        writeConfigPatch(0, blockWith(validStages()), {
          stage: { index: 0, rgb: [256, 0, 0] },
        })
      )
    ).toBe("OutOfRange");
  });

  it.each([8, -1])("refuses stage index %s", (index) => {
    expect(
      tagOf(
        writeConfigPatch(0, blockWith(validStages()), {
          stage: { index, x: 800 },
        })
      )
    ).toBe("OutOfRange");
  });

  it("refuses an active stage whose slot is not enabled", () => {
    expect(
      tagOf(writeConfigPatch(0, blockWith(validStages()), { activeStage: 3 }))
    ).toBe("UnsupportedValue");
  });

  it("accepts an active stage whose slot is enabled, and writes only block[12]", () => {
    const stages = validStages();
    stages[3] = stage(true, 50, 50, [0, 0, 0]);
    const base = blockWith(stages);

    const { frames } = Result.getOrThrow(
      writeConfigPatch(0, base, { activeStage: 3 })
    );

    const applied = applyFrames(base, frames);

    expect(applied[ACTIVE_AT]).toBe(3);
    expect(applied[STAGE_COUNT_AT]).toBe(1);
    expect(frames.map(addressOf)).toStrictEqual([0]);
  });

  it("refuses turning off the active stage", () => {
    const stages = validStages();
    stages[0] = stage(true, 800, 800, [0, 0, 0]);
    stages[1] = stage(true, 800, 800, [0, 0, 0]);

    expect(
      tagOf(
        writeConfigPatch(0, blockWith(stages), {
          stage: { enable: false, index: 0 },
        })
      )
    ).toBe("UnsupportedValue");
  });

  it("refuses turning off the only enabled stage", () => {
    const stages = validStages();
    stages[0] = stage(true, 800, 800, [0, 0, 0]);
    const base = blockWith(stages);
    base[ACTIVE_AT] = 5;

    expect(
      tagOf(writeConfigPatch(0, base, { stage: { enable: false, index: 0 } }))
    ).toBe("UnsupportedValue");
  });
});
