import { Fragment } from "react";
import type { ReactNode } from "react";

import { messages } from "./messages";
import type { MessageKey } from "./messages";

type Vars = Record<string, string | number>;

const SLOT = /\{(?<name>\w+)\}/gu;
const PART = /(?<slot>\{\w+\})/u;
const WHOLE = /^\{(?<name>\w+)\}$/u;

export const t = (key: MessageKey, vars: Vars = {}): string =>
  messages[key].replaceAll(SLOT, (whole, name: string) =>
    String(vars[name] ?? whole)
  );

export const rich = (
  key: MessageKey,
  vars: Partial<Record<string, ReactNode>>
): ReactNode =>
  messages[key].split(PART).map((part, i) => {
    const name = WHOLE.exec(part)?.groups?.name;

    return (
      <Fragment key={`${i}-${part}`}>
        {name === undefined ? part : vars[name]}
      </Fragment>
    );
  });

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono">{children}</span>
);
