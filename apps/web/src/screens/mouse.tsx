import {
  Button,
  cx,
  focusRing,
  Icon,
  Segmented,
  Select,
  Switch,
  toasts,
  UsageMeter,
} from "@beastx-ctl/ui";
import { Link } from "@tanstack/react-router";
import ChevronRight from "kubai-icons-react/icons/chevron-right";
import { useEffect } from "react";

import type { MessageKey } from "../copy/messages";
import { Mono, rich, t } from "../copy/t";
import {
  debounceMs,
  liftOffMm,
  pollingHz,
  sleepSeconds,
} from "../device/fixture";
import type { MouseSnapshot, Settings } from "../device/fixture";
import type { Source } from "../device/queries";
import { useBackup, useGate, useWriteSetting } from "../device/queries";
import { ExperimentalRow } from "./experimental-row";
import { LinkStatus } from "./link-status";
import { Page } from "./page";
import { SettingRow, Unknown } from "./setting-row";
import { Subject } from "./subject";

type Linked = Exclude<MouseSnapshot, { link: "none" }>;

const SETTING_LABELS = [
  "setting.polling",
  "setting.liftOff",
  "setting.sleep",
  "setting.motionSync",
  "setting.debounce",
  "setting.dpi",
] as const satisfies readonly MessageKey[];

const percent = (value: number) => t("unit.percent", { value });

const sleepLabel = (seconds: number) =>
  seconds < 60
    ? t("unit.s", { value: seconds })
    : t("unit.min", { value: seconds / 60 });

const hexByte = (value: number) => `0x${value.toString(16).padStart(2, "0")}`;

const BatteryMeter = ({ snapshot }: { snapshot: Linked }) => {
  if (snapshot.link !== "online") {
    return (
      <UsageMeter
        label={t("battery.label")}
        value={null}
        max={100}
        figure={percent}
      />
    );
  }

  const { battery } = snapshot;

  return battery.charging ? (
    <UsageMeter
      label={t("battery.charging", { percent: battery.percent })}
      value={battery.percent}
      max={100}
      figure={percent}
      showFigure={false}
    />
  ) : (
    <UsageMeter
      label={t("battery.label")}
      value={battery.percent}
      max={100}
      figure={percent}
    />
  );
};

const OnOff = ({ on }: { on: boolean }) => (
  <span className="w-6">{t(on ? "state.on" : "state.off")}</span>
);

const SettingsRows = ({
  settings,
  source,
  locked,
}: {
  settings: Settings | null;
  source: Source;
  locked: boolean;
}) => {
  const write = useWriteSetting(source);
  const activeDpi = settings?.stages[settings.activeStage]?.x;

  if (!settings) {
    return SETTING_LABELS.map((key) => (
      <SettingRow key={key} label={t(key)}>
        <Unknown />
      </SettingRow>
    ));
  }

  return (
    <>
      <SettingRow label={t("setting.polling")}>
        <Segmented
          className="max-sm:flex-1 max-sm:[&>*]:flex-1 max-sm:[&>*]:px-1"
          label={t("setting.polling")}
          value={String(settings.pollingIndex)}
          options={pollingHz.map((hz, i) => ({
            label: String(hz),
            value: String(i),
          }))}
          onValueChange={(v) => write({ pollingIndex: Number(v) })}
        />
        <span className="text-muted-foreground">{t("unit.hz")}</span>
      </SettingRow>
      <SettingRow label={t("setting.liftOff")}>
        <Segmented
          label={t("setting.liftOff")}
          value={String(settings.liftOffIndex)}
          options={liftOffMm.map((mm, i) => ({
            label: t("unit.mm", { value: mm }),
            value: String(i),
          }))}
          onValueChange={(v) => write({ liftOffIndex: Number(v) })}
        />
      </SettingRow>
      <SettingRow label={t("setting.sleep")}>
        <fieldset disabled={locked} className="contents">
          <Select
            label={t("setting.sleep")}
            value={String(settings.sleepSeconds)}
            options={sleepSeconds.map((s) => ({
              label: sleepLabel(s),
              value: String(s),
            }))}
            onValueChange={(v) => write({ sleepSeconds: Number(v) })}
          />
        </fieldset>
      </SettingRow>
      <SettingRow label={t("setting.motionSync")}>
        <Switch
          aria-label={t("setting.motionSync")}
          checked={settings.motionSync}
          disabled={locked}
          onCheckedChange={(motionSync) => write({ motionSync })}
        />
        <OnOff on={settings.motionSync} />
      </SettingRow>
      <SettingRow label={t("setting.debounce")}>
        <fieldset disabled={locked} className="contents">
          <Select
            label={t("setting.debounce")}
            value={String(settings.debounceMs)}
            options={debounceMs.map((ms) => ({
              label: t("unit.ms", { value: ms }),
              value: String(ms),
            }))}
            onValueChange={(v) => write({ debounceMs: Number(v) })}
          />
        </fieldset>
      </SettingRow>
      <SettingRow label={t("setting.dpi")}>
        <Link
          to="/dpi"
          search={(prev) => prev}
          data-kubai-trigger
          className={cx(
            "flex h-(--size-control) items-center gap-1 rounded-control pl-2 font-semibold text-foreground hover:bg-hover",
            focusRing
          )}
        >
          {t("unit.dpi", { value: activeDpi ?? "–" })}
          <Icon glyph={ChevronRight} size={16} animate />
        </Link>
      </SettingRow>
    </>
  );
};

const WriteError = ({ status }: { status: number }) => {
  useEffect(() => {
    const id = toasts.add({
      title: rich("write.error", { status: <Mono>{hexByte(status)}</Mono> }),
      type: "error",
    });

    return () => toasts.close(id);
  }, [status]);

  return null;
};

export const BackupNotice = ({ source }: { source: Source }) => {
  const gate = useGate(source);
  const backup = useBackup(source);

  if (source !== "device" || gate.data?.backedUp !== false) {
    return null;
  }

  return (
    <div className="rounded-container bg-group mt-6 flex flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <span className="text-muted-foreground">{t("write.backup")}</span>
      <Button
        variant="primary"
        disabled={backup.isPending}
        onClick={() => backup.mutate()}
      >
        {t("backup.action")}
      </Button>
    </div>
  );
};

export const MouseOverview = ({
  snapshot,
  source,
}: {
  snapshot: Linked;
  source: Source;
}) => {
  const locked = useGate(source).data?.experimental !== true;

  return (
    <Page
      subject={
        <Subject pose={snapshot.link === "asleep" ? "asleep" : "awake"} live />
      }
    >
      <h1 className="font-heading text-display text-foreground">
        {t("mouse.name")}
      </h1>
      <div className="mt-2.5">
        <LinkStatus snapshot={snapshot} />
      </div>
      <div className="mt-11">
        <BatteryMeter snapshot={snapshot} />
      </div>
      <div className="rounded-container bg-group mt-9 flex flex-col gap-2 px-4 py-3 sm:px-5">
        <SettingsRows
          settings={snapshot.link === "online" ? snapshot.settings : null}
          source={source}
          locked={locked}
        />
      </div>
      <div className="mt-4 px-4 sm:px-5">
        <ExperimentalRow source={source} />
      </div>
      <BackupNotice source={source} />
      {snapshot.link === "online" && snapshot.writeStatus !== null ? (
        <WriteError status={snapshot.writeStatus} />
      ) : null}
    </Page>
  );
};
