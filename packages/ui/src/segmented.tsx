import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

import { cx } from "./cx";
import { focusRing } from "./focus";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onValueChange: (value: T) => void;
  className?: string;
}

export const Segmented = <T extends string>({
  label,
  value,
  options,
  onValueChange,
  className,
}: SegmentedProps<T>) => (
  <RadioGroup
    data-slot="segmented"
    aria-label={label}
    value={value}
    onValueChange={(next) => {
      const hit = options.find((o) => o.value === next);

      if (hit) {
        onValueChange(hit.value);
      }
    }}
    className={cx(
      "not-typeset rounded-control bg-background inline-flex h-(--size-control) max-w-full items-stretch gap-0.5 p-0.5",
      className
    )}
  >
    {options.map((o) => (
      <Radio.Root
        key={o.value}
        value={o.value}
        className={cx(
          "flex min-w-0 cursor-pointer items-center justify-center rounded-xs px-2 text-body text-muted-foreground tabular-nums hover:text-foreground data-checked:bg-foreground data-checked:text-background",
          focusRing
        )}
      >
        {o.label}
      </Radio.Root>
    ))}
  </RadioGroup>
);
