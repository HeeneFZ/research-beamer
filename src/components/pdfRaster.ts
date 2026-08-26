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

/** 每画布最近一次成功渲染的 (abs@像素宽)——RO 初次回调与 effect 首绘同尺寸时跳过，
 *  避免同尺寸重置 canvas（width 赋值即使同值也清位图→600DPI 大画布白闪） */
const canvasDone = new WeakMap<HTMLCanvasElement, string>();

/** 每文档最近一次渲染位图（LRU≤6）：页面切换重挂画布时同步贴回，零白屏间隙 */
const bitmapCache = new Map<string, { bmp: OffscreenCanvas; w: number; h: number }>();

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

/** 把 PDF 首页按 cssWidth * pixelScale 像素宽渲染进 canvas。
 *  页面切换重挂/RO 同尺寸重复触发曾两次重置 canvas（width 赋值即使同值也清位图）
 *  并全量重渲——600DPI 大画布上即用户看到的反复白闪。现在：
 *  ① 同画布同尺寸已绘成 → 直接跳过；② 命中文档位图缓存 → 入口同步贴回
 *  （不进异步队列，挂载帧内出图）；③ 才走 pdf.js 渲染并写回缓存（LRU≤6）。
 *  目标像素宽统一按 floor(cssWidth×pixelScale) 计算（viewport.width 与其至多差
 *  浮点尾数，统一口径保证缓存键两侧一致）。 */
export function renderPdfToCanvas(abs: string, canvas: HTMLCanvasElement, cssWidth: number, pixelScale: number): void {
  const w = Math.max(1, Math.floor(cssWidth * pixelScale));
  const key = `${abs}@${w}`;
  if (canvasDone.get(canvas) === key && canvas.width === w) return; // RO 初次回调与首绘重复
  const cached = bitmapCache.get(abs);
  if (cached && cached.w === w) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = w;
      canvas.height = cached.h;
      ctx.drawImage(cached.bmp, 0, 0);
      canvasDone.set(canvas, key);
      return;
    }
  }
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
      const h = Math.max(1, Math.round(w * base.height / base.width));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const viewport = page.getViewport({ scale: w / base.width });
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (task.cancelled) return;
      canvasDone.set(canvas, key);
      // 写回文档级缓存（离屏位图；OffscreenCanvas 不可用时静默跳过）
      try {
        const bmp = new OffscreenCanvas(w, h);
        bmp.getContext('2d')!.drawImage(canvas, 0, 0);
        bitmapCache.delete(abs);
        bitmapCache.set(abs, { bmp, w, h });
        if (bitmapCache.size > 6) {
          const oldest = bitmapCache.keys().next().value;
          if (oldest !== undefined && oldest !== abs) bitmapCache.delete(oldest);
        }
      } catch { /* 缓存不可用不致命 */ }
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
