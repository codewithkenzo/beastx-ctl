import { Button as BaseButton } from "@base-ui/react/button";
import type { KubaiIconComponent } from "kubai-icons-react";

import { cx } from "./cx";
import { focusRing } from "./focus";
import { Icon } from "./icon";

export type ButtonProps = Omit<BaseButton.Props, "className"> & {
  variant?: "primary" | "quiet";
  icon?: KubaiIconComponent;
  className?: string;
};

const variants = {
  primary:
    "bg-primary text-primary-foreground [--ki-w:var(--primary)] font-semibold",
  quiet: "text-foreground hover:bg-hover active:bg-active",
};

export const Button = ({
  variant = "quiet",
  icon,
  className,
  children,
  ...rest
}: ButtonProps) => (
  <BaseButton
    data-slot="button"
    data-kubai-trigger
    className={cx(
      "not-typeset relative inline-flex h-(--size-control) shrink-0 cursor-pointer items-center gap-2 rounded-control px-(--size-pad-x) text-body select-none pointer-coarse:after:absolute pointer-coarse:after:inset-0 pointer-coarse:after:min-h-11",
      variants[variant],
      focusRing,
      className
    )}
    {...rest}
  >
    {icon ? <Icon glyph={icon} animate /> : null}
    {children}
  </BaseButton>
);
