import type { ReactNode } from "react";

import { cx } from "./cx";

export interface StatusProps {
  tone: "ok" | "idle" | "warn";
  children: ReactNode;
  id?: string;
}

const dot = { idle: "bg-field-border", ok: "bg-ok", warn: "bg-warn" };

export const Status = ({ tone, children, id }: StatusProps) => (
  <p
    data-slot="status"
    className="not-typeset text-body text-foreground flex flex-wrap items-center gap-x-2 gap-y-1"
  >
    <span
      aria-hidden
      className={cx("size-2 shrink-0 rounded-full", dot[tone])}
    />
    <span>{children}</span>
    {id ? (
      <span className="text-caption text-muted-foreground ml-2 font-mono">
        {id}
      </span>
    ) : null}
  </p>
);
