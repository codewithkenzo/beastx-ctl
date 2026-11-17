import { Context } from "effect";
import type { Effect } from "effect";

import type { TransportError } from "./errors";

export class Transport extends Context.Service<
  Transport,
  {
    readonly clear: Effect.Effect<void>;
    readonly receive: Effect.Effect<Uint8Array, TransportError>;
    readonly send: (frame: Uint8Array) => Effect.Effect<void, TransportError>;
  }
>()("device/Transport") {}
