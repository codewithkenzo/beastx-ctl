import { DormouseStage } from "@beastx-ctl/ui";

import { useTheme } from "../theme/store";

const POSTER_PX = 560;

export const Subject = ({
  pose,
  live,
}: {
  pose: "awake" | "asleep";
  live: boolean;
}) => {
  const { palette, resolved } = useTheme();

  return (
    <DormouseStage
      pose={pose}
      live={live}
      poster={`/posters/${palette}-${resolved}-${pose}.webp`}
      size={POSTER_PX}
    />
  );
};
