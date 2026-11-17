import type { KubaiIconComponent } from "kubai-icons-react";

import { useReducedMotion } from "./use-media-query";

export interface IconProps {
  glyph: KubaiIconComponent;
  size?: 16 | 20 | 24 | 48;
  animate?: boolean;
}

export const Icon = ({
  glyph: Glyph,
  size = 20,
  animate = false,
}: IconProps) => {
  const reduced = useReducedMotion();

  return (
    <Glyph
      size={size}
      trigger={animate && !reduced ? "parent" : "none"}
      className="shrink-0"
    />
  );
};
