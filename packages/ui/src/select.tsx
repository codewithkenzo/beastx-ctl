import { Select as BaseSelect } from "@base-ui/react/select";
import ChevronDown from "kubai-icons-react/icons/chevron-down";

import { cx } from "./cx";
import { focusRing } from "./focus";
import { Icon } from "./icon";

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
}

export const Select = <T extends string>({
  label,
  value,
  options,
  onValueChange,
}: SelectProps<T>) => (
  <BaseSelect.Root
    items={options}
    value={value}
    onValueChange={(next) => {
      const hit = options.find((o) => o.value === next);

      if (hit) {
        onValueChange(hit.value);
      }
    }}
  >
    <BaseSelect.Trigger
      aria-label={label}
      data-slot="select"
      className={cx(
        "not-typeset inline-flex h-(--size-control) min-w-28 cursor-pointer items-center justify-between gap-2 rounded-control border border-field-border pr-2 pl-(--size-pad-x) text-body tabular-nums hover:bg-hover",
        focusRing
      )}
    >
      <BaseSelect.Value />
      <BaseSelect.Icon className="text-muted-foreground flex">
        <Icon glyph={ChevronDown} size={16} />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        sideOffset={4}
        className="z-(--z-popup) outline-none"
      >
        <BaseSelect.Popup className="not-typeset rounded-container bg-surface-3 shadow-surface-4 min-w-(--anchor-width) p-1 outline-none">
          <BaseSelect.List className="max-h-(--available-height) overflow-y-auto">
            {options.map((o) => (
              <BaseSelect.Item
                key={o.value}
                value={o.value}
                className="rounded-control text-body data-highlighted:bg-hover flex h-(--size-control) cursor-pointer items-center px-(--size-pad-x) tabular-nums outline-none select-none data-selected:font-semibold"
              >
                <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
);
