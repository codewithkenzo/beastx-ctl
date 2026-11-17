import type { MessageKey } from "../copy/messages";
import {
  BackupRequired,
  RetriesExhausted,
  Timeout,
  TransportError,
  WriteMismatch,
} from "./errors";
import { NoVendorCollection } from "./webhid";

export interface Notice {
  readonly key: MessageKey;
  readonly vars: Readonly<Record<string, string | number>>;
}

const REPLY_TIMEOUT_MS = 500;

export const writeNotice = (error: Error): Notice | undefined => {
  if (error instanceof WriteMismatch) {
    return {
      key: "write.mismatch",
      vars: {
        actual: error.actual,
        expected: error.expected,
        field: error.field,
      },
    };
  }

  if (error instanceof Timeout || error instanceof RetriesExhausted) {
    return { key: "write.timeout", vars: { ms: REPLY_TIMEOUT_MS } };
  }

  if (error instanceof TransportError) {
    return { key: "write.transport", vars: { reason: error.message } };
  }

  if (error instanceof BackupRequired) {
    return { key: "write.backup", vars: {} };
  }

  return undefined;
};

export const connectNotice = (error: Error | null): Notice | undefined => {
  if (error instanceof NoVendorCollection) {
    return { key: "error.interface", vars: {} };
  }

  return undefined;
};
