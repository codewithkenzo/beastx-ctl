import { Menu } from "@base-ui/react/menu";
import type { KubaiIconComponent } from "kubai-icons-react";
import CircleCheck from "kubai-icons-react/icons/circle-check";

import { cx } from "./cx";
import { focusRing } from "./focus";
import { Icon } from "./icon";

interface RadioMenuGroup {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
}

export interface RadioMenuProps {
  label: string;
  icon: KubaiIconComponent;
  groups: readonly RadioMenuGroup[];
}

export const RadioMenu = ({ label, icon, groups }: RadioMenuProps) => (
  <Menu.Root>
    <Menu.Trigger
      aria-label={label}
      data-kubai-trigger
      className={cx(
        "not-typeset relative flex size-(--size-control) shrink-0 cursor-pointer items-center justify-center rounded-container text-muted-foreground hover:bg-hover hover:text-foreground data-popup-open:bg-selected data-popup-open:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-1",
        focusRing
      )}
    >
      <Icon glyph={icon} animate />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner
        sideOffset={8}
        align="end"
        className="z-(--z-popup) outline-none"
      >
        <Menu.Popup className="not-typeset rounded-container bg-surface-3 shadow-surface-4 flex w-52 flex-col gap-3 p-1 outline-none">
          {groups.map((g) => (
            <Menu.RadioGroup
              key={g.label}
              value={g.value}
              onValueChange={(v) => g.onValueChange(String(v))}
              className="flex flex-col"
            >
              <Menu.GroupLabel className="text-caption text-muted-foreground flex h-(--size-control-compact) items-center px-(--size-pad-x)">
                {g.label}
              </Menu.GroupLabel>
              {g.options.map((o) => (
                <Menu.RadioItem
                  key={o.value}
                  value={o.value}
                  closeOnClick={false}
                  className="rounded-control text-body data-highlighted:bg-hover flex h-(--size-control) cursor-pointer items-center justify-between gap-3 px-(--size-pad-x) outline-none select-none"
                >
                  {o.label}
                  <Menu.RadioItemIndicator className="text-foreground flex">
                    <Icon glyph={CircleCheck} size={16} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          ))}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);
