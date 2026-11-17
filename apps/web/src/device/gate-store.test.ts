import { DateTime, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOSED_STORED, GateStore } from "./gate-store";

const stubStorage = (raw: string | null) => {
  const cell = new Map<string, string>();

  if (raw !== null) {
    cell.set("beastx.gate", raw);
  }

  vi.stubGlobal("localStorage", {
    getItem: (key: string) => cell.get(key) ?? null,
    setItem: (key: string, value: string) => {
      cell.set(key, value);
    },
  });

  return cell;
};

const run = <A, E>(effect: Effect.Effect<A, E, GateStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(GateStore.layer)));

describe("gate store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads undecodable storage as closed", async () => {
    stubStorage("{not json");

    const loaded = await run(
      Effect.gen(function* loadGarbage() {
        const store = yield* GateStore;

        return yield* store.load;
      })
    );

    expect(loaded).toStrictEqual(CLOSED_STORED);
  });

  it("reads a missing value as closed", async () => {
    stubStorage(null);

    const loaded = await run(
      Effect.gen(function* loadMissing() {
        const store = yield* GateStore;

        return yield* store.load;
      })
    );

    expect(loaded).toStrictEqual(CLOSED_STORED);
  });

  it("loads back what it saved, backup time included", async () => {
    const cell = stubStorage(null);
    const backedUpAt = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

    const loaded = await run(
      Effect.gen(function* saveThenLoad() {
        const store = yield* GateStore;
        yield* store.save({ backedUpAt, experimental: true });

        return yield* store.load;
      })
    );

    expect(cell.get("beastx.gate")).toContain("2026-01-01T00:00:00.000Z");
    expect(loaded.backedUpAt && DateTime.formatIso(loaded.backedUpAt)).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(loaded.experimental).toBeTruthy();
  });
});
