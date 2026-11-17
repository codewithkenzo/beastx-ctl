import { NumberField as BaseNumberField } from "@base-ui/react/number-field";

import { cx } from "./cx";

export interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
}

export const NumberField = ({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
}: NumberFieldProps) => (
  <label
    data-slot="number-field"
    className={cx(
      "not-typeset inline-flex h-(--size-control) cursor-text items-center gap-2 rounded-control border border-field-border px-(--size-pad-x) text-body",
      "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring has-focus-visible:outline-solid"
    )}
  >
    <span className="text-muted-foreground">{label}</span>
    <BaseNumberField.Root
      value={value}
      min={min}
      max={max}
      step={step}
      format={{ useGrouping: false }}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange(next);
        }
      }}
    >
      <BaseNumberField.Input className="text-foreground w-11 bg-transparent text-right tabular-nums outline-none" />
    </BaseNumberField.Root>
  </label>
);
