import { ConfirmDialog, Switch } from "@beastx-ctl/ui";
import { useState } from "react";

import { t } from "../copy/t";
import { backupFile } from "../device/backup";
import type { Source } from "../device/queries";
import { useGate, useSetExperimental } from "../device/queries";

export const ExperimentalRow = ({ source }: { source: Source }) => {
  const [asking, setAsking] = useState(false);
  const on = useGate(source).data?.experimental === true;
  const setExperimental = useSetExperimental(source);

  return (
    <div className="text-muted-foreground flex min-h-(--size-control) items-center justify-between gap-4">
      <span>{t("experimental.label")}</span>
      <div className="flex items-center gap-3">
        <Switch
          aria-label={t("experimental.label")}
          checked={on}
          onCheckedChange={(next) => {
            if (next) {
              setAsking(true);

              return;
            }

            setExperimental(false);
          }}
        />
        <span className="w-6">{t(on ? "state.on" : "state.off")}</span>
      </div>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        onConfirm={() => setExperimental(true)}
        labels={{
          cancel: t("experimental.confirm.cancel"),
          confirm: t("experimental.confirm.ok"),
          title: t("experimental.confirm.body", { file: backupFile() }),
        }}
      />
    </div>
  );
};
