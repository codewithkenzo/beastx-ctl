import { Segmented } from "@beastx-ctl/ui";

import { t } from "../copy/t";
import {
  displayModes,
  displayPatchFor,
  useWriteDisplay,
} from "../device/display";
import type { MouseSnapshot } from "../device/fixture";
import type { Source } from "../device/queries";
import { BackupNotice } from "./mouse";
import { Page } from "./page";
import { SettingRow, Unknown } from "./setting-row";
import { Subject } from "./subject";

type Linked = Exclude<MouseSnapshot, { link: "none" }>;

export const DisplayScreen = ({
  snapshot,
  source,
}: {
  snapshot: Linked;
  source: Source;
}) => {
  const write = useWriteDisplay(source);

  return (
    <Page
      subject={
        <Subject
          pose={snapshot.link === "asleep" ? "asleep" : "awake"}
          live={false}
        />
      }
    >
      <h1 className="font-heading text-display text-foreground">
        {t("display.title")}
      </h1>
      <div className="rounded-container bg-group mt-9 flex flex-col gap-2 px-4 py-3 sm:px-5">
        <SettingRow label={t("display.mode")}>
          {snapshot.link === "online" ? (
            <Segmented
              label={t("display.mode")}
              value={String(snapshot.display.mode)}
              options={displayModes.map(({ key, mode }) => ({
                label: t(key),
                value: String(mode),
              }))}
              onValueChange={(value) => {
                const patch = displayPatchFor(value);

                if (patch) {
                  write(patch);
                }
              }}
            />
          ) : (
            <Unknown />
          )}
        </SettingRow>
      </div>
      <BackupNotice source={source} />
    </Page>
  );
};
