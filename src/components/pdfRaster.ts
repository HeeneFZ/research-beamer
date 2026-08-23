// PDF 矢量图渲染（移植自 EditorApp）：
// - 真 Web Worker：Vite `?worker&inline` 生成 blob URL Worker，绕过 file:// 页面对
//   `new Worker(file://…)` 的封锁。
// - 直接渲染进 DOM <canvas>：按 CSS 尺寸×pixelScale 出像素，无位图缓存；
//   缩放变化由上层防抖后按新分辨率重渲，期间旧位图由 CSS 拉伸显示。
// - 渲染队列：串行；同画布新任务自动取消旧任务。
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

type FileReadResult = { data?: Uint8Array; error?: string };
type PdfDoc = PDFDocumentProxy & { destroy?: () => Promise<void> };

// 共享 Worker 惰性单例：workerPort 模式下 doc.destroy() 只释放 worker 侧文档
let workerReady = false;
function ensureWorker(): void {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

/** 绝对路径 -> file:// URL：三斜杠 + 逐段编码（盘符冒号合法，不编码） */
export function fileUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, '/');
  return 'file:///' + norm.split('/').map(encodeURIComponent).join('/');
}

const pdfDocCache = new Map<string, Promise<PdfDoc>>();
const aspectCache = new Map<string, number>(); // abs -> 宽/高

export function pdfAspectSync(abs: string): number | undefined {
  return aspectCache.get(abs);
}

async function getPdfDoc(abs: string): Promise<PdfDoc> {
  ensureWorker();
  let p = pdfDocCache.get(abs);
  if (!p) {
    p = (async () => {
      const r: FileReadResult = await window.api.readFile(abs);
      if (r.error || !r.data) throw new Error(r.error || 'read fail');
      return await pdfjs.getDocument({ data: r.data.slice(0) }).promise;
    })();
    pdfDocCache.set(abs, p);
    // LRU：最多 8 份文档，超量淘汰最旧（不在途）
    if (pdfDocCache.size > 8) {
      const first = pdfDocCache.keys().next().value;
      if (first !== undefined && first !== abs) {
        const old = pdfDocCache.get(first);
        pdfDocCache.delete(first);
        void old?.then((d) => d.destroy?.()).catch(() => undefined);
      }
    }
  }
  return p;
}

/** PDF 首页纵横比（结果缓存） */
export async function ensurePdfAspect(abs: string): Promise<number> {
  const hit = aspectCache.get(abs);
  if (hit) return hit;
  const doc = await getPdfDoc(abs);
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const aspect = vp.width / vp.height;
  aspectCache.set(abs, aspect);
  return aspect;
}

// ---------- canvas 渲染队列（串行；同画布新任务取消旧任务） ----------

interface CanvasTask {
  canvas: HTMLCanvasElement;
  run(): Promise<void>;
  cancelled: boolean;
}

const taskQueue: CanvasTask[] = [];
let running = false;
const canvasTasks = new Map<HTMLCanvasElement, CanvasTask>();

function pumpQueue(): void {
  if (running) return;
  const t = taskQueue.shift();
  if (!t) return;
  running = true;
  t.run().catch(() => undefined).finally(() => {
    running = false;
    pumpQueue();
  });
}

/** 把 PDF 首页按 cssWidth * pixelScale 像素宽渲染进 canvas */
export function renderPdfToCanvas(abs: string, canvas: HTMLCanvasElement, cssWidth: number, pixelScale: number): void {
  const prev = canvasTasks.get(canvas);
  if (prev) prev.cancelled = true;
  const task: CanvasTask = {
    canvas,
    cancelled: false,
    run: async () => {
      if (task.cancelled) return;
      const doc = await getPdfDoc(abs);
      if (task.cancelled) return;
      const page = await doc.getPage(1);
      if (task.cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth * pixelScale) / base.width });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    },
  };
  canvasTasks.set(canvas, task);
  taskQueue.push(task);
  pumpQueue();
}

/** 取消某画布的进行中/排队任务（组件卸载时调用） */
export function cancelCanvasRender(canvas: HTMLCanvasElement): void {
  const t = canvasTasks.get(canvas);
  if (t) t.cancelled = true;
  canvasTasks.delete(canvas);
}
