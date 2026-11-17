import { Duration, Effect, Option } from "effect";

import type { IoError } from "./errors";
import type { HidSession } from "./hidraw";
import { Sysfs } from "./sysfs";

const HIDRAW_ROOT = "/sys/class/hidraw";
const HID_ID_LINE = "HID_ID=0003:000036A7:0000A887";
const VENDOR_COLLECTION: readonly number[] = [0x06, 0x1c, 0xff];
const INTERFACE_ZERO = "00";
const REPORT_ID = 0x04;
const RETRY_MARKER = 0x50;
const MAX_RESENDS = 3;
const REPLY_TIMEOUT = Duration.millis(500);
const POLL_INTERVAL = Duration.millis(10);

const decodeText = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes);

const hasHidId = (uevent: Uint8Array): boolean =>
  decodeText(uevent)
    .split("\n")
    .some((line) => line.trim() === HID_ID_LINE);

const isInterfaceZero = (bytes: Uint8Array): boolean =>
  decodeText(bytes).trim() === INTERFACE_ZERO;

const containsSequence = (
  haystack: Uint8Array,
  needle: readonly number[]
): boolean =>
  Array.from(
    { length: haystack.length - needle.length + 1 },
    (_unused, start) =>
      needle.every((byte, offset) => haystack[start + offset] === byte)
  ).some(Boolean);

const hasVendorCollection = (descriptor: Uint8Array): boolean =>
  containsSequence(descriptor, VENDOR_COLLECTION);

const isReplyTo = (report: Uint8Array, request: Uint8Array): boolean =>
  report.length === request.length &&
  report[0] === REPORT_ID &&
  (report[3] === request[3] || report[3] === RETRY_MARKER);

const isRetry = (report: Uint8Array): boolean => report[3] === RETRY_MARKER;

const isReceiverInterface = Effect.fnUntraced(function* isReceiverInterface(
  name: string
) {
  const sysfs = yield* Sysfs;
  const device = `${HIDRAW_ROOT}/${name}/device`;
  const uevent = yield* sysfs.readBytes(`${device}/uevent`);

  if (!Option.exists(uevent, hasHidId)) {
    return false;
  }

  const iface = yield* sysfs.readBytes(`${device}/../bInterfaceNumber`);

  if (!Option.exists(iface, isInterfaceZero)) {
    return false;
  }

  const descriptor = yield* sysfs.readBytes(`${device}/report_descriptor`);

  return Option.exists(descriptor, hasVendorCollection);
});

export const findReceiverNode = Effect.fnUntraced(function* findReceiverNode() {
  const sysfs = yield* Sysfs;
  const names = yield* sysfs.listDir(HIDRAW_ROOT);

  for (const name of names) {
    if (yield* isReceiverInterface(name)) {
      return Option.some(`/dev/${name}`);
    }
  }

  return Option.none<string>();
});

const awaitReply = (
  session: HidSession,
  request: Uint8Array
): Effect.Effect<Uint8Array, IoError> =>
  session.read.pipe(
    Effect.flatMap((report) => {
      if (Option.isSome(report) && isReplyTo(report.value, request)) {
        return Effect.succeed(report.value);
      }

      return Effect.andThen(
        Effect.sleep(POLL_INTERVAL),
        awaitReply(session, request)
      );
    })
  );

const sendOnce = (
  session: HidSession,
  request: Uint8Array
): Effect.Effect<Option.Option<Uint8Array>, IoError> =>
  Effect.andThen(
    session.write(request),
    awaitReply(session, request).pipe(Effect.timeoutOption(REPLY_TIMEOUT))
  );

const attempt = (
  session: HidSession,
  request: Uint8Array,
  resendsLeft: number
): Effect.Effect<Option.Option<Uint8Array>, IoError> =>
  sendOnce(session, request).pipe(
    Effect.flatMap((reply) => {
      if (!Option.exists(reply, isRetry)) {
        return Effect.succeed(reply);
      }

      return resendsLeft > 0
        ? attempt(session, request, resendsLeft - 1)
        : Effect.succeedNone;
    })
  );

export const exchange = (
  session: HidSession,
  request: Uint8Array
): Effect.Effect<Option.Option<Uint8Array>, IoError> =>
  attempt(session, request, MAX_RESENDS);
