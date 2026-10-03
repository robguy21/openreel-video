export type ReaderCanvas = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  timestamp: number;
  duration: number;
};

type CanvasSource = {
  getCanvas: (time: number) => Promise<ReaderCanvas | null>;
  canvases: (start?: number, end?: number) => AsyncGenerator<ReaderCanvas, void, unknown>;
};

export type CanvasReader = {
  read: (time: number) => Promise<ReaderCanvas | null>;
  close: () => void;
};

const MAX_FORWARD_GAP_S = 1;

export function sequentialCanvasReader(sink: unknown): CanvasReader {
  const source = sink as CanvasSource;
  let it: AsyncGenerator<ReaderCanvas, void, unknown> | null = null;
  let current: ReaderCanvas | null = null;
  let next: ReaderCanvas | null = null;
  let last = -Infinity;

  const close = () => {
    void it?.return(undefined);
    it = null;
    current = null;
    next = null;
  };

  const read = async (time: number): Promise<ReaderCanvas | null> => {
    if (it && time < last) {
      close();
      last = time;
      return source.getCanvas(time);
    }
    if (!it || time - last > MAX_FORWARD_GAP_S) {
      close();
      it = source.canvases(time);
      next = (await it.next()).value ?? null;
    }
    while (next && next.timestamp <= time + 1e-6) {
      current = next;
      next = (await it.next()).value ?? null;
    }
    last = time;
    return current ?? source.getCanvas(time);
  };

  return { read, close };
}
