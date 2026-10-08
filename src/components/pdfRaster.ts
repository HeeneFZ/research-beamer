// Lazy PDF worker, leased documents and prioritized offscreen rendering.
// Cache at most a preview and a detail bitmap per source; never write raster files.
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { mediaAspect, mediaFailure, mediaRevision, rememberMediaAspect, rememberMediaFailure } from '../model/mediaGeometry';

type PdfRuntime = typeof import('pdfjs-dist');
let runtime: Promise<PdfRuntime> | null = null;
function loadRuntime(): Promise<PdfRuntime> {
  if (!runtime) {
    runtime = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerPort = new worker.default();
      return pdfjs;
    }).catch((error) => { runtime = null; throw error; });
  }
  return runtime;
}

export function fileUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, '/');
  return 'file:///' + norm.split('/').map(encodeURIComponent).join('/');
}

interface PdfEntry {
  promise: Promise<PDFDocumentProxy>;
  users: number;
  ready: boolean;
  version: number;
}
const pdfDocCache = new Map<string, PdfEntry>();
function trimDocuments(): void {
  for (const [key, entry] of pdfDocCache) {
    if (pdfDocCache.size <= 8 && entry.version === mediaRevision()) continue;
    if (!entry.ready || entry.users > 0) continue;
    pdfDocCache.delete(key);
    void entry.promise.then((doc) => doc.destroy()).catch((error) => console.warn('PDF 文档释放失败：', error));
  }
}

async function withPdfDoc<T>(abs: string, use: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const version = mediaRevision();
  const key = `${version}|${abs}`;
  let entry = pdfDocCache.get(key);
  if (!entry) {
    const promise = (async () => {
      const pdfjs = await loadRuntime();
      const result = await window.api.readFile(abs);
      if ('error' in result) throw new Error(result.error);
      return pdfjs.getDocument({ data: result.data.slice(0) }).promise;
    })();
    const created: PdfEntry = { promise, users: 0, ready: false, version };
    created.promise = promise.then((doc) => {
      created.ready = true;
      return doc;
    }, (error) => {
      if (pdfDocCache.get(key) === created) pdfDocCache.delete(key);
      throw error;
    });
    entry = created;
  }
  pdfDocCache.delete(key);
  pdfDocCache.set(key, entry);
  entry.users++;
  try { return await use(await entry.promise); }
  finally { entry.users--; trimDocuments(); }
}

export const pdfAspectSync = mediaAspect;
export async function ensurePdfAspect(abs: string): Promise<number> {
  const failure = mediaFailure(abs);
  if (failure) throw new Error(failure);
  const hit = mediaAspect(abs);
  if (hit) return hit;
  const version = mediaRevision();
  return withPdfDoc(abs, async (doc) => {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const aspect = viewport.width / viewport.height;
    rememberMediaAspect(abs, aspect, version);
    return aspect;
  }).catch((error) => {
    rememberMediaFailure(abs, String(error), version);
    throw error;
  });
}

export const PDF_DPI_SCALE = 1200 / 96;
export const PDF_PREVIEW_WIDTH = 512;
const MAX_PIXELS = 16 * 1024 * 1024;
const CACHE_BYTES = 96 * 1024 * 1024;
interface CanvasTask {
  canvas: HTMLCanvasElement;
  key: string;
  priority: number;
  cancelled: boolean;
  render?: RenderTask;
  run(): Promise<void>;
}
interface Bitmap {
  source: string;
  version: number;
  canvas: HTMLCanvasElement;
  bytes: number;
}
const taskQueue: CanvasTask[] = [];
let running = false;
const canvasTasks = new WeakMap<HTMLCanvasElement, CanvasTask>();
const canvasDone = new WeakMap<HTMLCanvasElement, string>();
const bitmapCache = new Map<string, Bitmap>();
let cachedBytes = 0;

function removeBitmap(key: string, entry: Bitmap): void {
  bitmapCache.delete(key);
  cachedBytes -= entry.bytes;
  entry.canvas.width = entry.canvas.height = 0;
}
function cachePut(slot: string, entry: Bitmap): void {
  const old = bitmapCache.get(slot);
  if (old) removeBitmap(slot, old);
  bitmapCache.set(slot, entry);
  cachedBytes += entry.bytes;
  for (const [key, bitmap] of bitmapCache) {
    if (bitmap.version !== mediaRevision()) removeBitmap(key, bitmap);
  }
  while (cachedBytes > CACHE_BYTES) {
    // Retain cheap previews when discarding large detail buffers: revisits still show
    // an image immediately instead of waiting for another high-resolution render.
    const victim = [...bitmapCache.entries()].find(([key]) => key.endsWith('|detail'))
      ?? bitmapCache.entries().next().value!;
    removeBitmap(victim[0], victim[1]);
  }
}
function cacheFind(source: string, width: number, fallback = false): Bitmap | undefined {
  const candidates = [...bitmapCache.entries()].filter(([, b]) => b.source === source);
  const hit = candidates.filter(([, b]) => b.canvas.width >= width).sort((a, b) => a[1].canvas.width - b[1].canvas.width)[0]
    ?? (fallback ? candidates.sort((a, b) => b[1].canvas.width - a[1].canvas.width)[0] : undefined);
  if (!hit) return;
  bitmapCache.delete(hit[0]);
  bitmapCache.set(hit[0], hit[1]);
  return hit[1];
}
function pasteBitmap(canvas: HTMLCanvasElement, bitmap: HTMLCanvasElement, width: number, key?: string): void {
  canvas.width = width;
  canvas.height = Math.max(1, Math.round(width * bitmap.height / bitmap.width));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D 不可用');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (key) {
    canvasDone.set(canvas, key);
    delete canvas.dataset.mediaPending;
    delete canvas.dataset.mediaError;
  }
}
function pumpQueue(): void {
  if (running) return;
  const task = taskQueue.shift();
  if (!task) return;
  running = true;
  void task.run().catch((error) => {
    if (task.cancelled) return;
    task.canvas.dataset.mediaError = String(error);
    delete task.canvas.dataset.mediaPending;
    task.canvas.dispatchEvent(new Event('error'));
  }).finally(() => {
    if (canvasTasks.get(task.canvas) === task) canvasTasks.delete(task.canvas);
    running = false;
    pumpQueue();
  });
}

/** Fixed CSS geometry; cache previews appear synchronously while detail renders offscreen. */
export function renderPdfToCanvas(
  abs: string, canvas: HTMLCanvasElement, cssWidth: number, pixelScale: number,
  options: { thumbnail?: boolean; priority?: number } = {},
): void {
  const version = mediaRevision();
  const source = `${version}|${abs}`;
  const aspect = mediaAspect(abs) ?? 1;
  const width = Math.max(1, Math.min(Math.floor(cssWidth * pixelScale), Math.floor(Math.sqrt(MAX_PIXELS * aspect)), 16384));
  const key = `${source}@${width}`;
  const previous = canvasTasks.get(canvas);
  if (previous?.key === key && !previous.cancelled) return;
  cancelCanvasRender(canvas);
  if (canvasDone.get(canvas) === key && canvas.width > 0) return;
  const cached = cacheFind(source, width);
  if (cached) { pasteBitmap(canvas, cached.canvas, width, key); return; }
  canvas.dataset.mediaPending = 'true';
  delete canvas.dataset.mediaError;
  const preview = cacheFind(source, width, true);
  if (preview) pasteBitmap(canvas, preview.canvas, preview.canvas.width);
  const task: CanvasTask = {
    canvas, key, priority: options.priority ?? (options.thumbnail ? 0 : 2), cancelled: false,
    run: async () => {
      if (task.cancelled || version !== mediaRevision()) return;
      const completed = cacheFind(source, width);
      if (completed) { pasteBitmap(canvas, completed.canvas, width, key); return; }
      await withPdfDoc(abs, async (doc) => {
        if (task.cancelled || version !== mediaRevision()) return;
        const page = await doc.getPage(1);
        if (task.cancelled || version !== mediaRevision()) return;
        const base = page.getViewport({ scale: 1 });
        const target = Math.min(width, Math.floor(Math.sqrt(MAX_PIXELS * base.width / base.height)));
        const bitmap = document.createElement('canvas');
        bitmap.width = target;
        bitmap.height = Math.max(1, Math.floor(target * base.height / base.width));
        const context = bitmap.getContext('2d');
        if (!context) throw new Error('Canvas 2D 不可用');
        task.render = page.render({ canvasContext: context, background: '#ffffff', viewport: page.getViewport({ scale: target / base.width }) });
        try { await task.render.promise; }
        catch (error) { bitmap.width = bitmap.height = 0; throw error; }
        if (task.cancelled || version !== mediaRevision()) { bitmap.width = bitmap.height = 0; return; }
        pasteBitmap(canvas, bitmap, target, key);
        cachePut(`${source}|${options.thumbnail ? 'preview' : 'detail'}`, { source, version, canvas: bitmap, bytes: bitmap.width * bitmap.height * 4 });
      });
    },
  };
  canvasTasks.set(canvas, task);
  const position = taskQueue.findIndex((pending) => pending.priority < task.priority);
  taskQueue.splice(position < 0 ? taskQueue.length : position, 0, task);
  pumpQueue();
}

export function warmPdfPreview(abs: string): void {
  const source = `${mediaRevision()}|${abs}`;
  if (cacheFind(source, PDF_PREVIEW_WIDTH)) return;
  const canvas = document.createElement('canvas');
  renderPdfToCanvas(abs, canvas, PDF_PREVIEW_WIDTH, 1, { thumbnail: true, priority: 1 });
}

export function cancelCanvasRender(canvas: HTMLCanvasElement): void {
  const task = canvasTasks.get(canvas);
  if (!task) return;
  task.cancelled = true;
  task.render?.cancel();
  const queued = taskQueue.indexOf(task);
  if (queued >= 0) taskQueue.splice(queued, 1);
  canvasTasks.delete(canvas);
}
