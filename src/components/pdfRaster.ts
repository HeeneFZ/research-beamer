// PDF 服务：惰性 Worker、正在使用的文档保护、串行离屏绘制与位图复用。
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

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
}
const pdfDocCache = new Map<string, PdfEntry>();
const aspectCache = new Map<string, number>();

function trimDocuments(): void {
  for (const [abs, entry] of pdfDocCache) {
    if (pdfDocCache.size <= 8) break;
    if (!entry.ready || entry.users > 0) continue;
    pdfDocCache.delete(abs);
    void entry.promise.then((doc) => doc.destroy()).catch((error) => console.warn('PDF 文档释放失败：', error));
  }
}

async function withPdfDoc<T>(abs: string, use: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  let entry = pdfDocCache.get(abs);
  if (!entry) {
    const promise = (async () => {
      const pdfjs = await loadRuntime();
      const result = await window.api.readFile(abs);
      if ('error' in result) throw new Error(result.error);
      // PDF.js 把数据转交 Worker；复制以保留 IPC 返回数据的所有权。
      return pdfjs.getDocument({ data: result.data.slice(0) }).promise;
    })();
    const created: PdfEntry = { promise, users: 0, ready: false };
    created.promise = promise.then((doc) => {
      created.ready = true;
      return doc;
    }, (error) => {
      if (pdfDocCache.get(abs) === created) pdfDocCache.delete(abs);
      throw error;
    });
    entry = created;
  }
  pdfDocCache.delete(abs);
  pdfDocCache.set(abs, entry);
  entry.users++;
  try {
    return await use(await entry.promise);
  } finally {
    entry.users--;
    trimDocuments();
  }
}

export function pdfAspectSync(abs: string): number | undefined {
  return aspectCache.get(abs);
}

export async function ensurePdfAspect(abs: string): Promise<number> {
  const hit = aspectCache.get(abs);
  if (hit) return hit;
  return withPdfDoc(abs, async (doc) => {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const aspect = viewport.width / viewport.height;
    aspectCache.set(abs, aspect);
    return aspect;
  });
}

interface CanvasTask {
  canvas: HTMLCanvasElement;
  key: string;
  cancelled: boolean;
  render?: RenderTask;
  run(): Promise<void>;
}
const taskQueue: CanvasTask[] = [];
let running = false;
const canvasTasks = new WeakMap<HTMLCanvasElement, CanvasTask>();
const canvasDone = new WeakMap<HTMLCanvasElement, string>();
const bitmapCache = new Map<string, HTMLCanvasElement>();

function cachePut(key: string, bitmap: HTMLCanvasElement): void {
  bitmapCache.delete(key);
  bitmapCache.set(key, bitmap);
  if (bitmapCache.size > 6) bitmapCache.delete(bitmapCache.keys().next().value!);
}

function pasteBitmap(canvas: HTMLCanvasElement, bitmap: HTMLCanvasElement, key: string): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D 不可用');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  context.drawImage(bitmap, 0, 0);
  canvasDone.set(canvas, key);
  delete canvas.dataset.mediaPending;
  delete canvas.dataset.mediaError;
}

function pumpQueue(): void {
  if (running) return;
  const task = taskQueue.shift();
  if (!task) return;
  if (task.cancelled) { pumpQueue(); return; }
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

/** CSS 几何与栅格精度分离：同尺寸复用，在离屏画布完成后一次性贴回。 */
export function renderPdfToCanvas(abs: string, canvas: HTMLCanvasElement, cssWidth: number, pixelScale: number): void {
  const width = Math.max(1, Math.floor(cssWidth * pixelScale));
  const key = `${abs}@${width}`;
  const previous = canvasTasks.get(canvas);
  if (previous?.key === key && !previous.cancelled) return;
  // 快路径也必须取消旧目标，否则它完成时会覆盖刚贴回的缓存图。
  cancelCanvasRender(canvas);
  if (canvasDone.get(canvas) === key && canvas.width === width) {
    delete canvas.dataset.mediaPending;
    delete canvas.dataset.mediaError;
    return;
  }
  const cached = bitmapCache.get(key);
  if (cached) {
    cachePut(key, cached);
    pasteBitmap(canvas, cached, key);
    return;
  }
  canvas.dataset.mediaPending = 'true';
  delete canvas.dataset.mediaError;
  const task: CanvasTask = {
    canvas, key, cancelled: false,
    run: async () => {
      if (task.cancelled) return;
      // 排队期间同源同宽的先行任务可能已绘成，直接复用而不重复 page.render。
      const completed = bitmapCache.get(key);
      if (completed) {
        cachePut(key, completed);
        pasteBitmap(canvas, completed, key);
        return;
      }
      await withPdfDoc(abs, async (doc) => {
        if (task.cancelled) return;
        const page = await doc.getPage(1);
        if (task.cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const bitmap = document.createElement('canvas');
        bitmap.width = width;
        bitmap.height = Math.max(1, Math.round(width * base.height / base.width));
        const context = bitmap.getContext('2d');
        if (!context) throw new Error('Canvas 2D 不可用');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, bitmap.width, bitmap.height);
        task.render = page.render({ canvasContext: context, viewport: page.getViewport({ scale: width / base.width }) });
        await task.render.promise;
        if (task.cancelled) return;
        pasteBitmap(canvas, bitmap, key);
        cachePut(key, bitmap);
      });
    },
  };
  canvasTasks.set(canvas, task);
  taskQueue.push(task);
  pumpQueue();
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
