export const FRAME_LOG_LIMIT = 500;

export interface Frame {
  readonly at: number;
  readonly dir: "rx" | "tx";
  readonly hex: string;
  readonly skipped: boolean;
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");

export const appendFrame = (
  ring: readonly Frame[],
  frame: Frame
): readonly Frame[] => [...ring, frame].slice(-FRAME_LOG_LIMIT);

const empty: readonly Frame[] = [];
const store = { frames: empty };

export const recordFrame = (frame: Frame): void => {
  store.frames = appendFrame(store.frames, frame);
};

export const framesFile = (frames: readonly Frame[], date: Date) => ({
  name: `frames-${date.toISOString().replaceAll(":", "-")}.json`,
  text: JSON.stringify(frames, null, 2),
});

const downloadFile = (name: string, text: string): void => {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" })
  );

  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const frameConsole = {
  clearFrames: (): void => {
    store.frames = [];
  },
  frames: (): readonly Frame[] => store.frames,
  saveFrames: (): void => {
    const { name, text } = framesFile(store.frames, new Date());

    downloadFile(name, text);
  },
};
