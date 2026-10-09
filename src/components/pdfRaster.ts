// Lazy PDF worker and leased documents. Ordinary pages prepare 300DPI;
// an explicit preview/print may upgrade the same source, up to 1200DPI.
import type { PDFDocumentProxy } from 'pdfjs-dist';
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
  return (norm.startsWith('/') ? 'file://' : 'file:///') + norm.split('/').map(encodeURIComponent).join('/');
}

interface PdfEntry {
  promise: Promise<PDFDocumentProxy>;
  users: number;
  ready: boolean;
  version: number;
  stamp?: string;
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
export function releaseUnusedPdfDocuments(): void { trimDocuments(); }

async function withPdfDoc<T>(abs: string, use: (doc: PDFDocumentProxy, stamp?: string) => Promise<T>): Promise<T> {
  const version = mediaRevision();
  const key = `${version}|${abs}`;
  let entry = pdfDocCache.get(key);
  if (!entry) {
    let sourceStamp: string | undefined;
    const promise = (async () => {
      const pdfjs = await loadRuntime();
      const result = await window.api.readFile(abs);
      if ('error' in result) throw new Error(result.error);
      sourceStamp = result.stamp;
      return pdfjs.getDocument({ data: result.data.slice(0) }).promise;
    })();
    const created: PdfEntry = { promise, users: 0, ready: false, version };
    created.promise = promise.then((doc) => {
      created.ready = true;
      created.stamp = sourceStamp;
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
  try { return await use(await entry.promise, entry.stamp); }
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
    if (!(Number.isFinite(aspect) && aspect > 0)) throw new Error('PDF 页面尺寸无效');
    rememberMediaAspect(abs, aspect, version);
    return aspect;
  }).catch((error) => {
    rememberMediaFailure(abs, String(error), version);
    throw error;
  });
}

export const PDF_DPI_SCALE = 1200 / 96;
export const PDF_SLIDE_SCALE = 300 / 96;
export const PDF_PREVIEW_WIDTH = 512;
const MAX_PIXELS = 64 * 1024 * 1024;
const CANONICAL_CSS_WIDTH = 160 * 96 / 25.4 * 0.9;
const rasterWidth = (width: number, aspect: number) => Math.max(1, Math.min(Math.floor(width), Math.floor(Math.sqrt(MAX_PIXELS * aspect)), 16384, Math.floor(16384 * aspect)));
let activePreparations = 0;
const preparationWaiters: (() => void)[] = [];
async function withPreparationSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activePreparations < 2) activePreparations++;
  else await new Promise<void>((resolve) => preparationWaiters.push(resolve));
  try { return await run(); }
  finally { const next = preparationWaiters.shift(); if (next) next(); else activePreparations--; }
}
const preparing = new Map<string, Promise<import('../model/mediaResources').RasterResource>>();
const finalResources = new Map<string, import('../model/mediaResources').RasterResource>();
let resourceSession = '';

/** One lossless final raster per source. A later explicit zoom may replace it with a larger one. */
export function preparePdfRaster(abs: string, session: string, cssWidth = CANONICAL_CSS_WIDTH, pixelScale = PDF_SLIDE_SCALE): Promise<import('../model/mediaResources').RasterResource> {
  const version = mediaRevision();
  if (resourceSession !== session) { finalResources.clear(); resourceSession = session; }
  const widthRequest = Math.max(cssWidth * pixelScale, CANONICAL_CSS_WIDTH * PDF_SLIDE_SCALE);
  const previous = finalResources.get(`${session}|${abs}`);
  if (previous && previous.width >= rasterWidth(widthRequest, previous.aspect)) return Promise.resolve(previous);
  const key = `${session}|${abs}|${widthRequest}`;
  const hit = preparing.get(key);
  if (hit) return hit;
  const task = withPreparationSlot(async () => {
    if (version !== mediaRevision()) throw new Error('Resource session expired');
    return withPdfDoc(abs, async (doc, stamp) => {
    if (version !== mediaRevision()) throw new Error('Resource session expired');
    const page = await doc.getPage(1), base = page.getViewport({ scale: 1 });
    const aspect = base.width / base.height;
    if (!(aspect > 0 && Number.isFinite(aspect))) throw new Error('PDF 页面尺寸无效');
    const bitmap = document.createElement('canvas');
    bitmap.width = rasterWidth(widthRequest, aspect);
    bitmap.height = Math.max(1, Math.floor(bitmap.width / aspect));
    const context = bitmap.getContext('2d');
    if (!context) throw new Error('Canvas 2D 不可用');
    try {
      await page.render({ canvasContext: context, background: '#ffffff', viewport: page.getViewport({ scale: bitmap.width / base.width }) }).promise;
      if (version !== mediaRevision()) throw new Error('Resource session expired');
      const blob = await new Promise<Blob>((resolve, reject) => bitmap.toBlob((value) => value ? resolve(value) : reject(new Error('PDF 图像编码失败')), 'image/png'));
      if (version !== mediaRevision()) throw new Error('Resource session expired');
      const resource = await window.api.putRasterResource({ session, abs, width: bitmap.width, height: bitmap.height, aspect, stamp, data: await blob.arrayBuffer() });
      finalResources.set(`${session}|${abs}`, resource);
      return resource;
    } finally { bitmap.width = bitmap.height = 0; }
    });
  });
  preparing.set(key, task);
  void task.finally(() => preparing.delete(key)).catch(() => {});
  return task;
}

// The full-screen lightbox may request a higher zoom than a slide. It replaces the
// same canonical resource, rather than collecting raster variants for every zoom.
import { drawPreparedRaster } from './resourceRaster';
import type { MediaPreparation } from '../model/mediaResources';
const canvasTasks = new WeakMap<HTMLCanvasElement, { cancelled: boolean; key: string }>();
export function renderPdfToCanvas(abs: string, canvas: HTMLCanvasElement, cssWidth: number, pixelScale: number, preparation: MediaPreparation): void {
  const record = finalResources.get(`${preparation.session}|${abs}`) ?? preparation.resources[abs];
  const width = Math.max(1, Math.floor(cssWidth * pixelScale));
  const key = `${preparation.session}|${abs}@${width}`;
  if (canvasTasks.get(canvas)?.key === key) return;
  cancelCanvasRender(canvas);
  const task = { cancelled: false, key }; canvasTasks.set(canvas, task);
  canvas.dataset.mediaPending = 'true';
  const target = record ? rasterWidth(width, record.aspect) : width;
  const resource = record && record.width >= target ? Promise.resolve(record)
    : preparePdfRaster(abs, preparation.session, width / PDF_DPI_SCALE, PDF_DPI_SCALE);
  void resource.then((ready) => drawPreparedRaster(ready, canvas, width, () => !task.cancelled)).catch((error) => {
    if (task.cancelled) return;
    canvas.dataset.mediaError = String(error); delete canvas.dataset.mediaPending;
    canvas.dispatchEvent(new Event('error'));
  });
}
export function cancelCanvasRender(canvas: HTMLCanvasElement): void {
  const task = canvasTasks.get(canvas);
  if (task) task.cancelled = true;
  canvasTasks.delete(canvas);
}
