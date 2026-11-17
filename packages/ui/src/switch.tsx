import { Switch as BaseSwitch } from "@base-ui/react/switch";

import { cx } from "./cx";
import { focusRing } from "./focus";

export type SwitchProps = Omit<BaseSwitch.Root.Props, "className"> & {
  className?: string;
};

export const Switch = ({ className, ...rest }: SwitchProps) => (
  <BaseSwitch.Root
    data-slot="switch"
    className={cx(
      "not-typeset relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-control bg-field-border px-0.5 transition-colors duration-(--duration-fast) data-checked:bg-foreground motion-reduce:transition-none",
      focusRing,
      className
    )}
    {...rest}
  >
    <BaseSwitch.Thumb className="bg-background size-3.5 rounded-xs transition-transform duration-(--duration-fast) data-checked:translate-x-4 motion-reduce:transition-none" />
  </BaseSwitch.Root>
);
