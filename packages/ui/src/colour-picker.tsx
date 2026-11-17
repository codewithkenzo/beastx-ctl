import { Popover } from "@base-ui/react/popover";
import { HexColorPicker } from "react-colorful";

import { cx } from "./cx";
import { focusRing } from "./focus";

export interface ColourPickerProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}

export const ColourPicker = ({
  label,
  value,
  onValueChange,
}: ColourPickerProps) => (
  <Popover.Root>
    <Popover.Trigger
      aria-label={label}
      data-slot="colour-picker"
      className={cx(
        "not-typeset relative size-(--size-control) shrink-0 cursor-pointer rounded-control border border-field-border pointer-coarse:after:absolute pointer-coarse:after:-inset-1",
        focusRing
      )}
      style={{ backgroundColor: value }}
    />
    <Popover.Portal>
      <Popover.Positioner sideOffset={8} className="z-(--z-popup)">
        <Popover.Popup className="not-typeset rounded-container bg-surface-3 shadow-surface-4 flex flex-col gap-3 p-3 outline-none">
          <HexColorPicker color={value} onChange={onValueChange} />
          <span className="text-caption text-muted-foreground font-mono">
            {value}
          </span>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>
);
