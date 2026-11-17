import {
  activeStageFromChunk,
  decodeActiveProfile,
  decodeBatteryReply,
  decodeReplyFrame,
  pingFrame,
  readActiveProfileFrame,
  readBatteryFrame,
  readConfigChunkFrame,
  stageXChunkStart,
  stageXFromChunk,
} from "@beastx-ctl/protocol";
import { Effect, Option, Result } from "effect";

import { ConfigReplyMissing } from "./errors";
import { HidRaw } from "./hidraw";
import type { HidSession } from "./hidraw";
import { exchange, findReceiverNode } from "./receiver";

const PING_READY = 0xff;

type Reading =
  | { readonly kind: "asleep" }
  | { readonly kind: "none" }
  | {
      readonly kind: "online";
      readonly charging: boolean;
      readonly dpi: number;
      readonly percent: number;
      readonly stage: number;
    };

type ModuleLine =
  | { readonly alt: "none"; readonly text: "" }
  | {
      readonly alt: "asleep";
      readonly class: "beastx asleep";
      readonly text: "zz";
      readonly tooltip: "Beast X 4K asleep";
    }
  | {
      readonly alt: "charging" | "discharging";
      readonly class: "beastx";
      readonly dpi: number;
      readonly percentage: number;
      readonly stage: number;
      readonly text: string;
      readonly tooltip: string;
    };

const ASLEEP: Reading = { kind: "asleep" };
const NONE: Reading = { kind: "none" };

export const toModuleLine = (reading: Reading): ModuleLine => {
  if (reading.kind === "none") {
    return { alt: "none", text: "" };
  }

  if (reading.kind === "asleep") {
    return {
      alt: "asleep",
      class: "beastx asleep",
      text: "zz",
      tooltip: "Beast X 4K asleep",
    };
  }

  const state = reading.charging ? "charging" : "discharging";

  return {
    alt: state,
    class: "beastx",
    dpi: reading.dpi,
    percentage: reading.percent,
    stage: reading.stage,
    text: `${reading.percent}% · ${reading.dpi}`,
    tooltip: `Beast X 4K · ${reading.percent}% · ${state} · ${reading.dpi} DPI (stage ${reading.stage})`,
  };
};

const isPingReady = (reply: Uint8Array, request: Uint8Array): boolean => {
  const decoded = decodeReplyFrame(reply, request);

  return Result.isSuccess(decoded) && decoded.success.data[0] === PING_READY;
};

const configReply = Effect.fnUntraced(function* configReply(
  session: HidSession,
  request: Uint8Array
) {
  const reply = yield* exchange(session, request);

  if (Option.isNone(reply)) {
    return yield* new ConfigReplyMissing({});
  }

  const frame = yield* Effect.fromResult(
    decodeReplyFrame(reply.value, request)
  );

  return frame.data;
});

const readConfigChunk = Effect.fnUntraced(function* readConfigChunk(
  session: HidSession,
  profile: number,
  start: number
) {
  const request = yield* Effect.fromResult(
    readConfigChunkFrame(profile, start)
  );

  return yield* configReply(session, request);
});

const chunkAt = Effect.fnUntraced(function* chunkAt(
  session: HidSession,
  profile: number,
  head: Uint8Array,
  start: number
) {
  if (start === 0) {
    return head;
  }

  return yield* readConfigChunk(session, profile, start);
});

const readActiveStage = Effect.fnUntraced(function* readActiveStage(
  session: HidSession
) {
  const request = yield* Effect.fromResult(readActiveProfileFrame());
  const data = yield* configReply(session, request);
  const profile = yield* Effect.fromResult(decodeActiveProfile(data));
  const head = yield* readConfigChunk(session, profile, 0);
  const stage = yield* Effect.fromResult(activeStageFromChunk(head));
  const start = yield* Effect.fromResult(stageXChunkStart(stage));
  const chunk = yield* chunkAt(session, profile, head, start);
  const dpi = yield* Effect.fromResult(stageXFromChunk(chunk, start, stage));

  return { dpi, stage: stage + 1 };
});

const readOpenReceiver = Effect.fnUntraced(function* readOpenReceiver(
  path: string
) {
  const hid = yield* HidRaw;
  const session = yield* hid.open(path);
  const ping = yield* Effect.fromResult(pingFrame());
  const pong = yield* exchange(session, ping);

  if (Option.isNone(pong) || !isPingReady(pong.value, ping)) {
    return ASLEEP;
  }

  const request = yield* Effect.fromResult(readBatteryFrame());
  const reply = yield* exchange(session, request);

  if (Option.isNone(reply)) {
    return ASLEEP;
  }

  const frame = yield* Effect.fromResult(
    decodeReplyFrame(reply.value, request)
  );

  const level = yield* Effect.fromResult(decodeBatteryReply(frame.data));
  const active = yield* readActiveStage(session);

  return {
    charging: level.charging,
    dpi: active.dpi,
    kind: "online",
    percent: level.percent,
    stage: active.stage,
  } satisfies Reading;
});

export const readStatus = Effect.fnUntraced(function* readStatus() {
  const node = yield* findReceiverNode();

  if (Option.isNone(node)) {
    return NONE;
  }

  return yield* Effect.scoped(readOpenReceiver(node.value));
});
