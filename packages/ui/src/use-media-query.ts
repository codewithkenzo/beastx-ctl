import { useSyncExternalStore } from "react";

export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(query);
      media.addEventListener("change", onChange);

      return () => media.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => false
  );

export const useReducedMotion = (): boolean =>
  useMediaQuery("(prefers-reduced-motion: reduce)");
