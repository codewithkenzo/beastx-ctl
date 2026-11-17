import { Result } from "effect";

export const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");

export const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text.split(" "), (token) => Number.parseInt(token, 16));

export const tagOf = (
  result: Result.Result<unknown, { readonly _tag: string }>
): string | undefined =>
  Result.isFailure(result) ? result.failure._tag : undefined;

const frameView = (frame: Uint8Array): DataView =>
  new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

export const addressOf = (frame: Uint8Array): number =>
  frameView(frame).getUint16(5, true);

export const applyFrames = (
  block: Uint8Array,
  frames: readonly Uint8Array[]
): Uint8Array => {
  const out = Uint8Array.from(block);

  for (const frame of frames) {
    const length = frameView(frame).getUint8(4);

    out.set(frame.subarray(8, 8 + length), addressOf(frame));
  }

  return out;
};

export const changedBytes = (before: Uint8Array, after: Uint8Array): number[] =>
  Array.from({ length: before.length }, (_unused, i) => i).filter(
    (i) => before[i] !== after[i]
  );
