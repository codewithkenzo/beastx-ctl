import { decodeReplyFrame } from "@beastx-ctl/protocol";
import type { ReplyFrame } from "@beastx-ctl/protocol";
import { Clock, Effect } from "effect";
import type { Schema } from "effect";

import { RetriesExhausted, Timeout } from "./errors";
import type { DeviceError, TransportError } from "./errors";
import { recordFrame, toHex } from "./frame-log";
import { Transport } from "./transport";

const REPLY_TIMEOUT = "500 millis";
export const MAX_RESENDS = 3;

const RETRY_MARKER = 0x50;

type Reply = Schema.Schema.Type<typeof ReplyFrame>;

const logFrame = (
  dir: "rx" | "tx",
  bytes: Uint8Array,
  skipped: boolean
): Effect.Effect<void> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((at) => recordFrame({ at, dir, hex: toHex(bytes), skipped }))
  );

const nextReply = (
  cmd: number
): Effect.Effect<Uint8Array, Timeout | TransportError, Transport> =>
  Effect.gen(function* awaitReply() {
    const transport = yield* Transport;

    const bytes = yield* transport.receive.pipe(
      Effect.timeoutOrElse({
        duration: REPLY_TIMEOUT,
        orElse: () => Effect.fail(new Timeout({ cmd })),
      })
    );

    const kept = bytes[3] === cmd || bytes[3] === RETRY_MARKER;
    yield* logFrame("rx", bytes, !kept);

    if (kept) {
      return bytes;
    }

    return yield* nextReply(cmd);
  });

const attempt = (
  frame: Uint8Array,
  cmd: number,
  resendsLeft: number
): Effect.Effect<Reply, DeviceError, Transport> =>
  Effect.gen(function* sendOnce() {
    const transport = yield* Transport;

    yield* transport.clear;
    yield* logFrame("tx", frame, false);
    yield* transport.send(frame);

    const bytes = yield* nextReply(cmd);

    if (bytes[3] !== RETRY_MARKER) {
      return yield* Effect.fromResult(decodeReplyFrame(bytes, frame));
    }

    if (resendsLeft === 0) {
      return yield* Effect.fail(new RetriesExhausted({ cmd }));
    }

    return yield* attempt(frame, cmd, resendsLeft - 1);
  });

export const exchange = (
  frame: Uint8Array,
  cmd: number
): Effect.Effect<Reply, DeviceError, Transport> =>
  attempt(frame, cmd, MAX_RESENDS);
