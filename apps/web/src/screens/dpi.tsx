import { Button, ColourPicker, NumberField, Switch } from "@beastx-ctl/ui";
import { useForm } from "@tanstack/react-form";
import CircleDot from "kubai-icons-react/icons/circle-dot";

import { t } from "../copy/t";
import { dpiRange } from "../device/fixture";
import type { DpiStage, MouseSnapshot, Rgb } from "../device/fixture";
import type { Source } from "../device/queries";
import { useGate, useWriteSetting } from "../device/queries";
import { stagePatch, toggleStage } from "../device/snapshot";
import { ExperimentalRow } from "./experimental-row";
import { BackupNotice } from "./mouse";
import { Page } from "./page";
import { Subject } from "./subject";

type Linked = Exclude<MouseSnapshot, { link: "none" }>;

interface StageToggleProps {
  index: number;
  enabled: boolean;
  disabled: boolean;
  onToggle?: () => void;
}

interface StageRowProps {
  index: number;
  stage: DpiStage;
  active: boolean;
  toggle: StageToggleProps;
  onActivate: () => void;
  onChange: (stage: DpiStage) => void;
  locked: boolean;
}

const STAGE_SLOTS = 8;

const toHex = (rgb: Rgb): string =>
  `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const byte = (hex: string, at: number): number =>
  Number.parseInt(hex.slice(at, at + 2), 16);

const fromHex = (hex: string): Rgb => [
  byte(hex, 1),
  byte(hex, 3),
  byte(hex, 5),
];

const StageToggle = ({
  index,
  enabled,
  disabled,
  onToggle,
}: StageToggleProps) => {
  const label = t("dpi.stage.label", { index });

  return (
    <div className="flex items-center gap-3">
      <Switch
        aria-label={label}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
      <span className={enabled ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
};

const IdleRow = ({ toggle }: { toggle: StageToggleProps }) => (
  <div className="flex min-h-(--size-control) items-center tabular-nums">
    <StageToggle {...toggle} />
  </div>
);

const StageRow = ({
  index,
  stage,
  active,
  toggle,
  onActivate,
  onChange,
  locked,
}: StageRowProps) => {
  const form = useForm({
    defaultValues: { colour: toHex(stage.colour), x: stage.x, y: stage.y },
  });

  const commit = (patch: Partial<DpiStage>) => onChange({ ...stage, ...patch });

  return (
    <div
      aria-current={active ? "true" : undefined}
      className="flex min-h-(--size-control) flex-wrap items-center justify-between gap-x-4 gap-y-2 tabular-nums"
    >
      <StageToggle {...toggle} />
      <fieldset disabled={locked} className="contents">
        <div className="flex flex-wrap items-center gap-2">
          <form.Field name="x">
            {(field) => (
              <NumberField
                label={t("dpi.stage.x")}
                value={field.state.value}
                {...dpiRange}
                onValueChange={(x) => {
                  field.handleChange(x);
                  commit({ x });
                }}
              />
            )}
          </form.Field>
          <form.Field name="y">
            {(field) => (
              <NumberField
                label={t("dpi.stage.y")}
                value={field.state.value}
                {...dpiRange}
                onValueChange={(y) => {
                  field.handleChange(y);
                  commit({ y });
                }}
              />
            )}
          </form.Field>
          <form.Field name="colour">
            {(field) => (
              <ColourPicker
                label={t("dpi.stage.colour", { index })}
                value={field.state.value}
                onValueChange={(hex) => {
                  field.handleChange(hex);
                  commit({ colour: fromHex(hex) });
                }}
              />
            )}
          </form.Field>
          {active ? (
            <span className="text-muted-foreground flex h-(--size-control) items-center justify-center sm:w-36">
              {t("dpi.stage.active")}
            </span>
          ) : (
            <Button
              icon={CircleDot}
              onClick={onActivate}
              className="justify-center whitespace-nowrap sm:w-36"
            >
              {t("dpi.stage.activate")}
            </Button>
          )}
        </div>
      </fieldset>
    </div>
  );
};

export const DpiStages = ({
  snapshot,
  source,
}: {
  snapshot: Linked;
  source: Source;
}) => {
  const write = useWriteSetting(source);
  const locked = useGate(source).data?.experimental !== true;
  const settings = snapshot.link === "online" ? snapshot.settings : null;

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
        {t("dpi.title")}
      </h1>
      <div className="rounded-container bg-group mt-9 flex flex-col gap-2 px-4 py-3">
        {settings
          ? settings.stages.map((stage, i) => {
              const patch = toggleStage(settings, i, !stage.enabled);

              const toggle: StageToggleProps = {
                disabled: locked || patch === undefined,
                enabled: stage.enabled,
                index: i + 1,
                onToggle: () => {
                  if (patch) {
                    write(patch);
                  }
                },
              };

              return stage.enabled ? (
                <StageRow
                  key={`stage-${i + 1}`}
                  index={i + 1}
                  stage={stage}
                  active={settings.activeStage === i}
                  toggle={toggle}
                  locked={locked}
                  onActivate={() => write({ activeStage: i })}
                  onChange={(next) =>
                    write({ stage: stagePatch(i, stage, next) })
                  }
                />
              ) : (
                <IdleRow key={`stage-${i + 1}`} toggle={toggle} />
              );
            })
          : Array.from({ length: STAGE_SLOTS }, (_, i) => (
              <IdleRow
                key={`stage-${i + 1}`}
                toggle={{ disabled: true, enabled: false, index: i + 1 }}
              />
            ))}
      </div>
      <div className="mt-4 px-4 sm:px-5">
        <ExperimentalRow source={source} />
      </div>
      <BackupNotice source={source} />
    </Page>
  );
};
