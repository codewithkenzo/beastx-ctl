import { Status } from "@beastx-ctl/ui";

import { t } from "../copy/t";
import { receiverId } from "../device/fixture";
import type { MouseSnapshot } from "../device/fixture";

export const LinkStatus = ({
  snapshot,
}: {
  snapshot: Exclude<MouseSnapshot, { link: "none" }>;
}) => {
  if (snapshot.link === "online") {
    return (
      <Status tone="ok" id={receiverId}>
        {t("status.online")}
      </Status>
    );
  }

  if (snapshot.link === "asleep") {
    return (
      <Status tone="idle" id={receiverId}>
        {t("mouse.asleep")}
      </Status>
    );
  }

  return (
    <Status tone="idle" id={receiverId}>
      {t("read.progress", { done: snapshot.done, total: snapshot.total })}
    </Status>
  );
};
