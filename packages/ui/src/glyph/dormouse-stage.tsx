import { useEffect, useRef, useState } from "react";

import { cx } from "../cx";
import { useReducedMotion } from "../use-media-query";
import { dormouseGlsl, dormouseView, LOOP, printFrom } from "./dormouse";
import type { Pose } from "./dormouse";
import { createStage } from "./engine";
import type { Stage } from "./engine";

const BUDGET_MS = 4;
const SAMPLES = 30;
const CELLS = [3, 4, 6] as const;

interface GlyphApi {
  readonly seek: (t: number) => void;
  readonly renderer: () => string;
  readonly loop: number;
  readonly cell: number;
}

declare global {
  interface Window {
    glyph?: GlyphApi;
  }
}

export interface DormouseStageProps {
  pose: Pose;
  poster: string;
  live: boolean;
  size: number;
}

const medianFrameMs = (stage: Stage): number => {
  stage.render(0);
  stage.sync();

  const times = Array.from({ length: SAMPLES }, (_, i) => {
    const start = performance.now();
    stage.render(i / SAMPLES);
    stage.sync();

    return performance.now() - start;
  }).toSorted((a, b) => a - b);

  return times[Math.floor(SAMPLES / 2)] ?? Number.POSITIVE_INFINITY;
};

const readPrint = () => {
  const root = document.documentElement;
  const css = getComputedStyle(root);

  return printFrom(
    {
      ground: css.getPropertyValue("--glyph-ground"),
      ink: css.getPropertyValue("--foreground"),
      muted: css.getPropertyValue("--muted-foreground"),
      plate: css.getPropertyValue("--primary"),
    },
    !root.classList.contains("dark")
  );
};

const build = (
  canvas: HTMLCanvasElement,
  pose: Pose
): { stage: Stage; cell: number } | null => {
  if (!canvas.getContext("webgl2")) {
    return null;
  }

  const options = {
    glsl: dormouseGlsl(pose),
    loop: LOOP,
    print: readPrint(),
    view: dormouseView,
  };

  try {
    for (const cell of CELLS) {
      const stage = createStage(canvas, { ...options, cell });

      if (medianFrameMs(stage) <= BUDGET_MS) {
        return { cell, stage };
      }
    }
  } catch (error) {
    document.documentElement.dataset.glyphError = String(error).slice(0, 200);
  }

  return null;
};

const runLive = (
  canvas: HTMLCanvasElement,
  pose: Pose,
  onRunning: (running: boolean) => void
): (() => void) => {
  const root = document.documentElement;
  const t0 = performance.now();
  let stage: Stage | null = null;
  let raf = 0;
  let width = canvas.clientWidth;

  const frame = (t: number) => {
    const ph = (Math.PI * 2 * t) / LOOP;
    stage?.setLight(-0.55 + 0.25 * Math.cos(ph), 0.65 + 0.12 * Math.sin(ph));
    stage?.render(t);
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    stage = null;
    onRunning(false);
    delete window.glyph;
  };

  const tick = () => {
    frame((performance.now() - t0) / 1000);
    raf = requestAnimationFrame(tick);
  };

  const boot = () => {
    cancelAnimationFrame(raf);
    const built = build(canvas, pose);

    if (!built) {
      stop();
      root.dataset.glyph = "poster";

      return;
    }

    ({ stage } = built);
    window.glyph = {
      cell: built.cell,
      loop: LOOP,
      renderer: () => built.stage.renderer(),
      seek: (t) => {
        frame(t);
        built.stage.sync();
      },
    };
    root.dataset.glyph = "ready";
    onRunning(true);
    tick();
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    stop();
    root.dataset.glyph = "lost";
  };

  const themes = new MutationObserver(boot);

  const sizes = new ResizeObserver(() => {
    if (canvas.clientWidth !== width) {
      width = canvas.clientWidth;
      boot();
    }
  });

  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", boot);
  themes.observe(root, { attributeFilter: ["class"], attributes: true });
  sizes.observe(canvas);
  boot();

  return () => {
    themes.disconnect();
    sizes.disconnect();
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", boot);
    stop();
    delete root.dataset.glyph;
  };
};

export const DormouseStage = ({
  pose,
  poster,
  live,
  size,
}: DormouseStageProps) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [running, setRunning] = useState(false);
  const wantLive = live && !reduced;

  useEffect(() => {
    const el = canvas.current;

    if (!wantLive || !el) {
      return;
    }

    return runLive(el, pose, setRunning);
  }, [wantLive, pose]);

  return (
    <div
      aria-hidden
      data-slot="dormouse"
      className="pointer-events-none relative aspect-square w-full"
    >
      <img
        src={poster}
        alt=""
        width={size}
        height={size}
        className={cx("absolute inset-0 size-full", running && "invisible")}
      />
      {wantLive ? (
        <canvas
          ref={canvas}
          className={cx("absolute inset-0 size-full", !running && "invisible")}
        />
      ) : null}
    </div>
  );
};
