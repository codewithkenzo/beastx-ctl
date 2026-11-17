/* oxlint-disable unicorn/throw-new-error, eslint/max-classes-per-file */
import { Effect, Function, Layer, Option, Queue, Schema } from "effect";

import { TransportError } from "./errors";
import { Transport } from "./transport";

export const RECEIVER_FILTER = {
  productId: 0xa8_87,
  vendorId: 0x36_a7,
};

const REPORT_ID = 4;
const FRAME_BYTES = 64;
const VENDOR_USAGE_PAGE = 0xff_1c;
const VENDOR_USAGE = 0x92;

export interface VendorCollection {
  readonly usage: number;
  readonly usagePage: number;
}

interface InputReportEvent {
  readonly data: DataView;
  readonly reportId: number;
}

export type InputReportListener = (event: InputReportEvent) => void;

export interface ReceiverDevice {
  readonly addEventListener: (
    type: "inputreport",
    listener: InputReportListener
  ) => void;
  readonly close: () => Promise<void>;
  readonly collections: readonly VendorCollection[];
  readonly open: () => Promise<void>;
  readonly opened: boolean;
  readonly productId: number;
  readonly removeEventListener: (
    type: "inputreport",
    listener: InputReportListener
  ) => void;
  readonly sendReport: (reportId: number, data: Uint8Array) => Promise<void>;
  readonly vendorId: number;
}

interface HidApi {
  readonly getDevices: () => Promise<readonly ReceiverDevice[]>;
  readonly requestDevice: (options: {
    readonly filters: readonly (typeof RECEIVER_FILTER)[];
  }) => Promise<readonly ReceiverDevice[]>;
}

type ConnectionEventType = "connect" | "disconnect";

interface ConnectionEvent {
  readonly device: ReceiverDevice;
}

type ConnectionListener = (event: ConnectionEvent) => void;

interface HidEvents {
  readonly addEventListener: (
    type: ConnectionEventType,
    listener: ConnectionListener
  ) => void;
  readonly removeEventListener: (
    type: ConnectionEventType,
    listener: ConnectionListener
  ) => void;
}

export interface ReceiverWatch {
  readonly onConnect: (device: ReceiverDevice) => void;
  readonly onDisconnect: (device: ReceiverDevice) => void;
}

export class NotPicked extends Schema.TaggedError<NotPicked>()("NotPicked", {
  cause: Schema.Unknown,
}) {}

export class NoVendorCollection extends Schema.TaggedError<NoVendorCollection>()(
  "NoVendorCollection",
  { productId: Schema.Number }
) {}

const isHidApi = (value: unknown): value is HidApi =>
  value instanceof Object && "getDevices" in value && "requestDevice" in value;

const hidApi = (): HidApi | undefined => {
  const nav: unknown = globalThis.navigator;

  return nav instanceof Object && "hid" in nav && isHidApi(nav.hid)
    ? nav.hid
    : undefined;
};

const isHidEvents = (value: unknown): value is HidEvents =>
  value instanceof Object &&
  "addEventListener" in value &&
  "removeEventListener" in value;

const hidEvents = (): HidEvents | undefined => {
  const nav: unknown = globalThis.navigator;

  return nav instanceof Object && "hid" in nav && isHidEvents(nav.hid)
    ? nav.hid
    : undefined;
};

const hasVendorCollection = (device: ReceiverDevice): boolean =>
  device.collections.some(
    (collection) =>
      collection.usagePage === VENDOR_USAGE_PAGE &&
      collection.usage === VENDOR_USAGE
  );

const isReceiver = (device: ReceiverDevice): boolean =>
  device.vendorId === RECEIVER_FILTER.vendorId &&
  device.productId === RECEIVER_FILTER.productId &&
  hasVendorCollection(device);

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toFrame = (data: DataView): Uint8Array => {
  const frame = new Uint8Array(FRAME_BYTES);

  frame[0] = REPORT_ID;
  frame.set(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength).subarray(
      0,
      FRAME_BYTES - 1
    ),
    1
  );

  return frame;
};

export const pickReceiver: Effect.Effect<
  ReceiverDevice,
  NotPicked | NoVendorCollection
> = Effect.gen(function* pickReceiver() {
  const hid = hidApi();

  if (hid === undefined) {
    return yield* new NotPicked({ cause: "WebHID is not available" });
  }

  const devices = yield* Effect.tryPromise({
    catch: (cause) => new NotPicked({ cause }),
    try: () => hid.requestDevice({ filters: [RECEIVER_FILTER] }),
  });

  if (devices.length === 0) {
    return yield* new NotPicked({ cause: "no device chosen" });
  }

  const device = devices.find(hasVendorCollection);

  if (device === undefined) {
    return yield* new NoVendorCollection({
      productId: devices[0]?.productId ?? 0,
    });
  }

  return device;
});

export const pairedReceiver: Effect.Effect<Option.Option<ReceiverDevice>> =
  Effect.gen(function* pairedReceiver() {
    const hid = hidApi();

    if (hid === undefined) {
      return Option.none<ReceiverDevice>();
    }

    const devices = yield* Effect.tryPromise(() => hid.getDevices()).pipe(
      Effect.orElseSucceed((): readonly ReceiverDevice[] => [])
    );

    return Option.fromNullishOr(devices.find(isReceiver));
  });

export const watchReceivers = (watch: ReceiverWatch): (() => void) => {
  const hid = hidEvents();

  if (hid === undefined) {
    return Function.constVoid;
  }

  const connect: ConnectionListener = (event) => {
    if (isReceiver(event.device)) {
      watch.onConnect(event.device);
    }
  };

  const disconnect: ConnectionListener = (event) => {
    if (isReceiver(event.device)) {
      watch.onDisconnect(event.device);
    }
  };

  hid.addEventListener("connect", connect);
  hid.addEventListener("disconnect", disconnect);

  return () => {
    hid.removeEventListener("connect", connect);
    hid.removeEventListener("disconnect", disconnect);
  };
};

export const webHidTransport = (
  device: ReceiverDevice
): Layer.Layer<Transport, TransportError> =>
  Layer.effect(
    Transport,
    Effect.gen(function* webHidTransportEffect() {
      const queue = yield* Queue.unbounded<Uint8Array>();

      const listener: InputReportListener = (event) => {
        if (event.reportId === REPORT_ID) {
          Queue.offerUnsafe(queue, toFrame(event.data));
        }
      };

      yield* Effect.acquireRelease(
        Effect.sync(() => device.addEventListener("inputreport", listener)),
        () =>
          Effect.sync(() => device.removeEventListener("inputreport", listener))
      );

      if (!device.opened) {
        yield* Effect.acquireRelease(
          Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                message: `open failed: ${messageOf(cause)}`,
              }),
            try: () => device.open(),
          }),
          () => Effect.tryPromise(() => device.close()).pipe(Effect.ignore)
        );
      }

      return Transport.of({
        clear: Queue.clear(queue).pipe(Effect.asVoid),
        receive: Queue.take(queue),
        send: (frame) =>
          frame.length !== FRAME_BYTES || frame[0] !== REPORT_ID
            ? Effect.fail(
                new TransportError({
                  message: `refused frame: ${frame.length} bytes, report ${frame[0]}`,
                })
              )
            : Effect.tryPromise({
                catch: (cause) =>
                  new TransportError({
                    message: `sendReport failed: ${messageOf(cause)}`,
                  }),
                try: () => device.sendReport(REPORT_ID, frame.slice(1)),
              }),
      });
    })
  );
