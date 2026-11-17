import { ToastRegion } from "@beastx-ctl/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";

import { t } from "../copy/t";
import { useLiveReceiver } from "../device/live";
import { Shell } from "../screens/shell";

const Root = () => {
  useLiveReceiver();

  return (
    <MotionConfig reducedMotion="user">
      <Shell>
        <Outlet />
      </Shell>
      <ToastRegion dismissLabel={t("toast.dismiss")} />
    </MotionConfig>
  );
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    component: Root,
  }
);
