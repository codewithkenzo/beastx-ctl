import type { ReactNode } from "react";

export const SettingRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex min-h-(--size-control) flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <span className="text-foreground">{label}</span>
    <div className="flex min-w-0 grow items-center justify-end gap-3 tabular-nums">
      {children}
    </div>
  </div>
);

export const Unknown = () => <span className="text-muted-foreground">–</span>;
