/* oxlint-disable unicorn/throw-new-error */
import {
  Effect,
  Function,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
} from "effect";

import { Device } from "./device";
import { GateStore } from "./gate-store";
import type { ReceiverDevice } from "./webhid";
import { pairedReceiver, pickReceiver, webHidTransport } from "./webhid";

class NoReceiver extends Schema.TaggedError<NoReceiver>()("NoReceiver", {
  reason: Schema.String,
}) {}

const makeDeviceRuntime = (receiver: ReceiverDevice) =>
  ManagedRuntime.make(
    Device.layer.pipe(
      Layer.provide(Layer.merge(webHidTransport(receiver), GateStore.layer))
    )
  );

type DeviceRuntime = ReturnType<typeof makeDeviceRuntime>;

interface Connection {
  readonly pending: Set<Promise<unknown>>;
  readonly ready: Promise<void>;
  readonly receiver: ReceiverDevice;
  readonly runtime: DeviceRuntime;
}

type ConnectedListener = () => void;

let current: Connection | undefined;
let restoring: Promise<boolean> | undefined;
const connectedListeners = new Set<ConnectedListener>();

const retire = async (connection: Connection): Promise<void> => {
  await Promise.allSettled(connection.pending);
  await connection.runtime.dispose();
};

const connect = async (receiver: ReceiverDevice): Promise<void> => {
  const previous = current;

  const ready = previous === undefined ? Promise.resolve() : retire(previous);

  current = {
    pending: new Set(),
    ready,
    receiver,
    runtime: makeDeviceRuntime(receiver),
  };

  for (const listener of connectedListeners) {
    listener();
  }

  await ready;
};

const restore = async (): Promise<boolean> => {
  const paired = await Effect.runPromise(pairedReceiver);

  if (Option.isNone(paired)) {
    return false;
  }

  await connect(paired.value);

  return true;
};

export const hasReceiver = (): boolean => current !== undefined;

export const holdsReceiver = (receiver: ReceiverDevice): boolean =>
  current?.receiver === receiver;

export const onConnected = (listener: ConnectedListener): (() => void) => {
  connectedListeners.add(listener);

  return () => {
    connectedListeners.delete(listener);
  };
};

export const dropReceiver = async (): Promise<void> => {
  const dropped = current;

  current = undefined;

  if (dropped !== undefined) {
    await retire(dropped);
  }
};

export const releaseReceiver = async (
  receiver: ReceiverDevice
): Promise<boolean> => {
  if (current?.receiver !== receiver) {
    return false;
  }

  await dropReceiver();

  return true;
};

export const restoreReceiver = (): Promise<boolean> => {
  if (current !== undefined) {
    return Promise.resolve(true);
  }

  restoring ??= restore().finally(() => {
    restoring = undefined;
  });

  return restoring;
};

export const pickAndConnect = async (): Promise<void> => {
  await connect(await Effect.runPromise(pickReceiver));
};

export const runDevice = <A, E>(
  effect: Effect.Effect<A, E, Device>
): Promise<A> => {
  const connection = current;

  if (connection === undefined) {
    return Promise.reject(new NoReceiver({ reason: "no receiver picked" }));
  }

  const run = connection.ready.then(() =>
    connection.runtime.runPromise(effect)
  );

  const tracked = run
    .catch(Function.constVoid)
    .finally(() => connection.pending.delete(tracked));

  connection.pending.add(tracked);

  return run;
};
