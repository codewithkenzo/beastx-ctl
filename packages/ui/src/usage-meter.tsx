import { Meter } from "@base-ui/react/meter";
import { useEffect, useState } from "react";

import { cx } from "./cx";

export interface UsageMeterProps {
  label: string;
  value: number | null;
  max: number;
  figure: (value: number) => string;
  showFigure?: boolean;
}

let filledOnce = false;

export const UsageMeter = ({
  label,
  value,
  max,
  figure,
  showFigure = true,
}: UsageMeterProps) => {
  const [shown, setShown] = useState(filledOnce);
  useEffect(() => {
    if (filledOnce) {
      return;
    }

    const id = requestAnimationFrame(() => {
      filledOnce = true;
      setShown(true);
    });

    return () => cancelAnimationFrame(id);
  }, []);
  const over = value !== null && value / max > 0.9;

  return (
    <Meter.Root
      data-slot="usage-meter"
      value={shown && value !== null ? value : 0}
      max={max}
      className="not-typeset text-body grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-2.5"
    >
      <Meter.Label
        className={value === null ? "text-muted-foreground" : "text-foreground"}
      >
        {label}
      </Meter.Label>
      {showFigure ? (
        <Meter.Value
          className={cx(
            "tabular-nums",
            over ? "text-destructive" : "text-foreground"
          )}
        >
          {() => (value === null ? "–" : figure(value))}
        </Meter.Value>
      ) : (
        <span />
      )}
      <Meter.Track className="hatch bg-track col-span-2 h-2">
        <Meter.Indicator
          className={cx(
            "h-full transition-[width] duration-(--duration-slow) ease-(--ease-enter) motion-reduce:transition-none",
            over ? "bg-destructive" : "bg-primary"
          )}
        />
      </Meter.Track>
    </Meter.Root>
  );
};
