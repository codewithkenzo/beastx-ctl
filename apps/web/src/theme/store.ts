import { useMediaQuery } from "@beastx-ctl/ui";
import { createStore, useSelector } from "@tanstack/react-store";

export const palettes = ["flexoki", "gao-ji-gan", "everforest"] as const;
export const grounds = ["system", "paper", "ink"] as const;

export type Palette = (typeof palettes)[number];

export type Ground = (typeof grounds)[number];

const KEYS = {
  ground: "beastx-ctl.ground",
  palette: "beastx-ctl.palette",
} as const;

const DARK = "(prefers-color-scheme: dark)";

const pick = <T extends string>(
  list: readonly T[],
  raw: string | null,
  fallback: T
): T => list.find((v) => v === raw) ?? fallback;

const theme = createStore({
  ground: pick(grounds, localStorage.getItem(KEYS.ground), "system"),
  palette: pick(palettes, localStorage.getItem(KEYS.palette), "gao-ji-gan"),
});

export const setPalette = (palette: Palette) =>
  theme.setState((s) => ({ ...s, palette }));

export const setGround = (ground: Ground) =>
  theme.setState((s) => ({ ...s, ground }));

export const startTheme = () => {
  const media = matchMedia(DARK);

  const apply = () => {
    const { palette, ground } = theme.get();
    const ink = ground === "ink" || (ground === "system" && media.matches);
    const root = document.documentElement;

    for (const p of palettes) {
      root.classList.toggle(`palette-${p}`, p === palette);
    }

    root.classList.toggle("dark", ink);
    localStorage.setItem(KEYS.palette, palette);
    localStorage.setItem(KEYS.ground, ground);
  };

  apply();
  theme.subscribe(apply);
  media.addEventListener("change", apply);
};

export const useTheme = () => {
  const state = useSelector(theme);
  const systemInk = useMediaQuery(DARK);

  const ink =
    state.ground === "ink" || (state.ground === "system" && systemInk);

  return { ...state, resolved: ink ? ("ink" as const) : ("paper" as const) };
};
