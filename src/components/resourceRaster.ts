// Main owns one final PNG per source. Screen and thumbnail copies are RAM-only;
// navigation never competes with thumbnails for the large, decoded source.
import type { RasterResource } from '../model/mediaResources';
interface Job { priority: number; run: () => Promise<void> }
interface Decoded { key: string; retired: boolean; resource: RasterResource; bitmap?: ImageBitmap; pending: Promise<ImageBitmap>; users: number; bytes: number; job: Job }
interface DisplayRaster { canvas?: HTMLCanvasElement; width: number; pending?: Promise<void>; source?: Decoded; users: number }
const decoded = new Map<string, Decoded>();
const LIMIT = 96 * 1024 * 1024;
let bytes = 0;
export const SCREEN_RASTER_LIMIT = 192 * 1024 * 1024;
const THUMB_LIMIT = 16 * 1024 * 1024;
const screens = new Map<string, DisplayRaster>();
const thumbs = new Map<string, DisplayRaster>();
let pinned = new Set<string>();
let pinRequests: { resource: RasterResource; width: number }[] = [];
let epoch = 0;
const jobs: Job[] = [];
let running = false;
const resourceKey = (resource: RasterResource) => `${resource.session}|${resource.id}|${resource.version}`;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (jobs.length) {
      jobs.sort((a, b) => a.priority - b.priority);
      await jobs.shift()!.run();
      // Let input/paint run between image decodes, including during background warmup.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally { running = false; }
}

export function screenRasterWidth(resource: RasterResource, width: number): number {
  return Math.max(1, Math.min(resource.width, Math.ceil(width / 128) * 128));
}
export function screenRasterReady(resource: RasterResource, width: number): boolean {
  const entry = screens.get(resourceKey(resource));
  return !!entry?.canvas && entry.canvas.width >= screenRasterWidth(resource, width);
}

function trimDisplay(cache: Map<string, DisplayRaster>, limit: number): void {
  let used = 0;
  for (const entry of cache.values()) if (entry.canvas) used += entry.canvas.width * entry.canvas.height * 4;
  for (const [key, entry] of cache) {
    if (used <= limit) break;
    if (!entry.canvas || entry.pending || entry.users || (cache === screens && pinned.has(key))) continue;
    cache.delete(key);
    used -= entry.canvas.width * entry.canvas.height * 4;
    entry.canvas.width = entry.canvas.height = 0;
  }
}

/** Caller orders current-page sources first, then the +/-5 page neighbourhood. */
export function pinScreenRasters(requests: { resource: RasterResource; width: number }[]): void {
  pinRequests = requests;
  rebuildPins();
  trimDisplay(screens, SCREEN_RASTER_LIMIT);
}
function rebuildPins(): void {
  const next = new Set<string>();
  let used = 0;
  for (const { resource, width } of pinRequests) {
    const key = resourceKey(resource);
    if (next.has(key)) continue;
    const w = Math.max(screenRasterWidth(resource, width), screens.get(key)?.width ?? 0, screens.get(key)?.canvas?.width ?? 0);
    const cost = w * Math.round(w / resource.aspect) * 4;
    if (used + cost > SCREEN_RASTER_LIMIT) continue;
    next.add(key); used += cost;
  }
  pinned = next;
}

function trim(): void {
  for (const [key, entry] of decoded) {
    if (bytes <= LIMIT) break;
    if (!entry.bitmap || entry.users) continue;
    decoded.delete(key); bytes -= entry.bytes; entry.bitmap.close();
  }
}
function lease(resource: RasterResource, priority = 0): Decoded {
  const key = resourceKey(resource);
  let entry = decoded.get(key);
  if (!entry) {
    const generation = epoch;
    const created = { key, retired: false, resource, users: 0, bytes: 0 } as Decoded;
    created.pending = new Promise<ImageBitmap>((resolve, reject) => {
      created.job = { priority, run: async () => {
        try {
          if (generation !== epoch) throw new Error('资源会话已结束');
          const result = await window.api.readRasterResource(resource);
          const bitmap = await createImageBitmap(new Blob([result.data.slice().buffer], { type: 'image/png' }));
          if (generation !== epoch) { bitmap.close(); throw new Error('资源会话已结束'); }
          created.resource = result; created.bitmap = bitmap; created.bytes = bitmap.width * bitmap.height * 4;
          bytes += created.bytes; trim(); resolve(bitmap);
        } catch (error) {
          if (decoded.get(key) === created) decoded.delete(key);
          reject(error);
        }
      } };
      jobs.push(created.job);
    });
    entry = created;
  }
  entry.job.priority = Math.min(entry.job.priority, priority);
  decoded.delete(key); decoded.set(key, entry); entry.users++;
  void drain();
  return entry;
}
function release(entry: Decoded): void {
  entry.users--;
  if (!entry.users && entry.bitmap && entry.retired) { entry.bitmap.close(); bytes -= entry.bytes; entry.bitmap = undefined; }
  trim();
}

function displayRaster(resource: RasterResource, width: number, thumbnail: boolean, priority: number): DisplayRaster {
  const key = resourceKey(resource), cache = thumbnail ? thumbs : screens;
  const w = screenRasterWidth(resource, width);
  let entry = cache.get(key);
  if (entry && entry.canvas && entry.canvas.width >= w) {
    cache.delete(key); cache.set(key, entry); return entry;
  }
  if (entry?.pending) {
    entry.width = Math.max(entry.width, w);
    if (entry.source) entry.source.job.priority = Math.min(entry.source.job.priority, priority);
    return entry;
  }
  entry ??= { width: w, users: 0 };
  entry.width = Math.max(entry.width, w);
  cache.delete(key); cache.set(key, entry);
  const target = entry, generation = epoch;
  const source = lease(resource, priority);
  target.source = source;
  const bake = (bitmap: ImageBitmap) => {
    if (generation !== epoch) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(target.width, bitmap.width);
    canvas.height = Math.max(1, Math.round(canvas.width * bitmap.height / bitmap.width));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D 不可用');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (target.canvas) target.canvas.width = target.canvas.height = 0;
    target.canvas = canvas;
    if (!thumbnail) rebuildPins();
  };
  target.pending = (source.bitmap ? Promise.resolve().then(() => bake(source.bitmap!)) : source.pending.then(bake))
    .finally(() => { target.pending = undefined; target.source = undefined; release(source); });
  return target;
}

function paint(source: CanvasImageSource & { width: number; height: number }, canvas: HTMLCanvasElement, width: number, valid: () => boolean): void {
  if (!valid()) return;
  canvas.width = Math.max(1, Math.min(Math.ceil(width), source.width));
  canvas.height = Math.max(1, Math.round(canvas.width * source.height / source.width));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D 不可用');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  delete canvas.dataset.mediaPending; delete canvas.dataset.mediaError;
  canvas.dispatchEvent(new Event('mediaready', { bubbles: true }));
}

/** Hits paint before the browser's first frame. Printing keeps the final 1200DPI source. */
export function drawPreparedRaster(resource: RasterResource, canvas: HTMLCanvasElement, width: number, valid: () => boolean, purpose: 'screen' | 'thumb' | 'print' = 'screen'): Promise<void> {
  if (purpose === 'print') {
    const source = lease(resource);
    if (source.bitmap) { try { paint(source.bitmap, canvas, width, valid); return Promise.resolve(); } finally { release(source); } }
    return source.pending.then((bitmap) => paint(bitmap, canvas, width, valid)).finally(() => release(source));
  }
  const entry = displayRaster(resource, width, purpose === 'thumb', purpose === 'thumb' ? 50 : 0);
  entry.users++;
  if (entry.canvas && entry.canvas.width >= Math.min(Math.ceil(width), resource.width)) {
    try { paint(entry.canvas, canvas, width, valid); return Promise.resolve(); } finally { entry.users--; }
  }
  return entry.pending!.then(() => { if (entry.canvas) paint(entry.canvas, canvas, width, valid); })
    .finally(() => { entry.users--; trimDisplay(purpose === 'thumb' ? thumbs : screens, purpose === 'thumb' ? THUMB_LIMIT : SCREEN_RASTER_LIMIT); });
}

export async function warmScreenRaster(resource: RasterResource, width: number, priority = 10): Promise<void> {
  const entry = displayRaster(resource, width, false, priority);
  await entry.pending;
  trimDisplay(screens, SCREEN_RASTER_LIMIT);
}
export function clearDecodedRasters(): void {
  epoch++; pinned.clear(); pinRequests = [];
  for (const cache of [screens, thumbs]) {
    for (const entry of cache.values()) if (entry.canvas) entry.canvas.width = entry.canvas.height = 0;
    cache.clear();
  }
  for (const [key, entry] of decoded) {
    entry.retired = true; decoded.delete(key);
    if (entry.bitmap && !entry.users) { entry.bitmap.close(); bytes -= entry.bytes; entry.bitmap = undefined; }
  }
}
