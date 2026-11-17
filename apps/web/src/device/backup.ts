/* oxlint-disable unicorn/throw-new-error */
import { Effect, Schema } from "effect";

import type { BackupInput } from "./device";
import { receiverId } from "./fixture";

export class BackupDownloadError extends Schema.TaggedError<BackupDownloadError>()(
  "BackupDownloadError",
  { message: Schema.String }
) {}

export const backupFile = (date = new Date()): string =>
  `backup-${date.toISOString().slice(0, 10)}.json`;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const backupDocument = (input: BackupInput, date: Date): string =>
  JSON.stringify(
    {
      battery: input.battery,
      config: toHex(input.config),
      date: date.toISOString(),
      display: toHex(input.display),
      profile: input.profile,
      receiver: receiverId,
    },
    null,
    2
  );

const downloadBackup = (text: string, date: Date): void => {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" })
  );

  const link = document.createElement("a");

  link.href = url;
  link.download = backupFile(date);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const downloadBackupFile = (input: BackupInput) =>
  Effect.try({
    catch: (error) =>
      new BackupDownloadError({
        message: error instanceof Error ? error.message : "download failed",
      }),
    try: () => {
      const date = new Date();

      downloadBackup(backupDocument(input, date), date);
    },
  });
