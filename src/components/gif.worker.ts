// GIF frames are decoded once at display precision, outside the UI thread.
// The renderer grants a RAM reservation before the worker produces the frames.
declare class ImageDecoder {
  constructor(options: { data: ReadableStream<Uint8Array>; type: string; preferAnimation: boolean; desiredWidth?: number; desiredHeight?: number });
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; repetitionCount: number } };
  completed: Promise<void>;
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
interface Job { id: number; url: string; width: number; aspect: number; priority: number; cancelled: boolean; abort?: AbortController; decoder?: ImageDecoder; allow?: (value: boolean) => void }
type Request = { type: 'prepare'; id: number; url: string; width: number; aspect: number; priority: number } | { type: 'allow'; id: number; allowed: boolean } | { type: 'priority'; id: number; priority: number } | { type: 'remove'; id: number };
const port = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent<Request>) => void) | null };
const jobs = new Map<number, Job>();
const queue: Job[] = [];
let running = false;
async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      queue.sort((a, b) => a.priority - b.priority);
      const job = queue.shift()!;
      if (!job.cancelled) await prepare(job);
    }
  } finally { running = false; }
}
async function prepare(job: Job): Promise<void> {
  if (job.cancelled) return;
  try {
    job.abort = new AbortController();
    const response = await fetch(job.url, { signal: job.abort.signal });
    if (!response.ok || !response.body) throw new Error('GIF 读取失败');
    const decoder = new ImageDecoder({ data: response.body, type: 'image/gif', preferAnimation: true,
      ...(job.aspect > 0 ? { desiredWidth: job.width, desiredHeight: Math.max(1, Math.round(job.width / job.aspect)) } : {}) });
    job.decoder = decoder;
    await decoder.tracks.ready; await decoder.completed;
    if (job.cancelled) return;
    const track = decoder.tracks.selectedTrack;
    let raster: OffscreenCanvas | null = null;
    let context: OffscreenCanvasRenderingContext2D | null = null;
    for (let index = 0; index < track.frameCount; index++) {
      if (job.cancelled) return;
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        const aspect = job.aspect || image.displayWidth / image.displayHeight;
        const width = Math.max(1, Math.min(job.width, image.displayWidth));
        const height = Math.max(1, Math.round(width / aspect));
        if (!index) {
          const allowed = new Promise<boolean>((resolve) => { job.allow = resolve; });
          port.postMessage({ type: 'metadata', id: job.id, width, height, aspect, loops: track.repetitionCount, bytes: width * height * 4 * track.frameCount });
          if (!await allowed || job.cancelled) return;
        }
        if (!raster) {
          // Keep the full frame cache in system RAM. GPU-backed bitmaps for every
          // frame can exhaust VRAM and restart the shared GPU process while flipping.
          raster = new OffscreenCanvas(width, height); context = raster.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Canvas 2D 不可用');
          context.imageSmoothingQuality = 'high';
        }
        context!.clearRect(0, 0, width, height); context!.drawImage(image, 0, 0, width, height);
        if (job.cancelled) return;
        const bitmap = raster.transferToImageBitmap();
        port.postMessage({ type: 'frame', id: job.id, bitmap, duration: Math.max(10, (image.duration ?? 100000) / 1000) }, [bitmap]);
      } finally { image.close(); }
    }
    if (!job.cancelled) {
      context?.getImageData(0, 0, 1, 1);
      port.postMessage({ type: 'prepared', id: job.id });
    }
  } catch (error) {
    if (!job.cancelled) port.postMessage({ type: 'error', id: job.id, error: String(error) });
  } finally { job.decoder?.close(); jobs.delete(job.id); }
}
port.onmessage = ({ data }) => {
  if (data.type === 'prepare') {
    const job: Job = { ...data, cancelled: false }; jobs.set(data.id, job);
    queue.push(job); void drain();
  } else {
    const job = jobs.get(data.id); if (!job) return;
    if (data.type === 'priority') job.priority = Math.min(job.priority, data.priority);
    else if (data.type === 'allow') { job.allow?.(data.allowed); job.allow = undefined; }
    else { job.cancelled = true; job.abort?.abort(); job.decoder?.close(); job.allow?.(false); jobs.delete(data.id); }
  }
};
export {};
