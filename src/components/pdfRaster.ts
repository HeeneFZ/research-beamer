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

/** 已渲位图缓存：键 abs@像素宽（同一文档在编辑画布/放映窗/放大镜是不同宽度，各自缓存；
 *  LRU≤6，600DPI 位图约 14MB/张）。值为脱离 DOM 的 canvas——永不挂载即永不上屏，
 *  渲染中间态（pdf.js 分块绘制）对外不可见，彻底消除首渲多帧部分重绘的「闪很多次」。 */
const bitmapCache = new Map<string, HTMLCanvasElement>();

function cachePut(key: string, buf: HTMLCanvasElement): void {
  bitmapCache.delete(key); // Map 末位=最新
  bitmapCache.set(key, buf);
  if (bitmapCache.size > 6) {
    const oldest = bitmapCache.keys().next().value;
    if (oldest !== undefined) bitmapCache.delete(oldest);
  }
}

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
 *  曾经两个可见缺陷：① 页面重挂/RO 同尺寸重复触发 → canvas.width 重复重置
 *  （width 赋值即使同值也清位图）→ 白闪；② 首次渲染直接画在可见 canvas 上，
 *  pdf.js 分块渐进绘制 → 多帧部分重绘（用户看到的「闪很多次」）。
 *  现在：① 同画布同尺寸已绘成 → 跳过；② 命中位图缓存 → 入口同步贴回（不进
 *  异步队列，挂载帧内出图）；③ 未命中 → 渲进离屏缓冲，完成后一次性贴回
 *  （单一原子帧），缓冲入缓存。目标像素宽统一 floor(cssWidth×pixelScale)，
 *  与渲染任务同口径保证缓存键两侧一致。 */
export function renderPdfToCanvas(abs: string, canvas: HTMLCanvasElement, cssWidth: number, pixelScale: number): void {
  const w = Math.max(1, Math.floor(cssWidth * pixelScale));
  const key = `${abs}@${w}`;
  if (canvasDone.get(canvas) === key && canvas.width === w) return; // RO 初次回调与首绘重复
  const cached = bitmapCache.get(key);
  if (cached) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = w;
      canvas.height = cached.height;
      ctx.drawImage(cached, 0, 0);
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
      // 离屏缓冲：脱离 DOM 的 canvas，渐进中间态不上屏
      const buf = document.createElement('canvas');
      buf.width = w;
      buf.height = h;
      const bctx = buf.getContext('2d');
      if (!bctx) return;
      bctx.fillStyle = '#ffffff';
      bctx.fillRect(0, 0, w, h);
      const viewport = page.getViewport({ scale: w / base.width });
      await page.render({ canvasContext: bctx, viewport }).promise;
      if (task.cancelled) return;
      // 原子贴回：width 重置 + 位图绘制在同一同步段，浏览器整段后才合成——单帧完整出图
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(buf, 0, 0);
      canvasDone.set(canvas, key);
      cachePut(key, buf);
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
