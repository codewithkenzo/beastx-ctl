import { Button } from "@beastx-ctl/ui";
import { useNavigate } from "@tanstack/react-router";
import Download from "kubai-icons-react/icons/download";
import Plug from "kubai-icons-react/icons/plug";

import { t } from "../copy/t";
import { backupFile } from "../device/backup";
import { connectNotice } from "../device/error-copy";
import { configBytes, displayBytes } from "../device/fixture";
import type { MouseSnapshot } from "../device/fixture";
import type { Source } from "../device/queries";
import { useBackup, usePickReceiver } from "../device/queries";
import { LinkStatus } from "./link-status";
import { Page } from "./page";
import { Subject } from "./subject";

export const ConnectEmpty = ({ source }: { source: Source }) => {
  const navigate = useNavigate();
  const pick = usePickReceiver();
  const notice = connectNotice(pick.error);

  return (
    <Page subject={<Subject pose="asleep" live={false} />}>
      <h1 className="font-heading text-display text-foreground">
        {t("connect.empty.title")}
      </h1>
      <p className="text-foreground mt-3">{t("connect.empty.body")}</p>
      <div className="mt-8">
        <Button
          variant="primary"
          icon={Plug}
          onClick={() => {
            if (source !== "device") {
              navigate({ search: { state: "ready" }, to: "/" });

              return;
            }

            pick.mutate(undefined, {
              onSuccess: () => navigate({ search: {}, to: "/" }),
            });
          }}
        >
          {t("connect.action")}
        </Button>
        {notice === undefined ? null : (
          <p className="text-destructive mt-4">{t(notice.key, notice.vars)}</p>
        )}
      </div>
    </Page>
  );
};

export const BackupStep = ({
  snapshot,
  source,
}: {
  snapshot: Exclude<MouseSnapshot, { link: "none" }>;
  source: Source;
}) => {
  const navigate = useNavigate();
  const backup = useBackup(source);

  return (
    <Page subject={<Subject pose="asleep" live={false} />}>
      <h1 className="font-heading text-display text-foreground">
        {t("mouse.name")}
      </h1>
      <div className="mt-2.5">
        <LinkStatus snapshot={snapshot} />
      </div>
      <div className="mt-8 flex flex-col items-start gap-3">
        <Button
          variant="primary"
          icon={Download}
          onClick={() =>
            backup.mutate(undefined, {
              onSuccess: () => navigate({ to: "/mouse" }),
            })
          }
        >
          {t("backup.action")}
        </Button>
        <p className="text-caption text-muted-foreground">
          {t("backup.detail", {
            config: configBytes,
            display: displayBytes,
            file: backupFile(),
          })}
        </p>
      </div>
    </Page>
  );
};
