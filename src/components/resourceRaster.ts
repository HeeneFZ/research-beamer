// Final decoded images are shared within a renderer; compressed PNGs live in Main.
import type { RasterResource } from '../model/mediaResources';
interface Decoded { key: string; retired: boolean; resource: RasterResource; bitmap?: ImageBitmap; pending: Promise<ImageBitmap>; users: number; bytes: number }
const decoded = new Map<string, Decoded>();
const LIMIT = 96 * 1024 * 1024;
let bytes = 0;
let decoding = Promise.resolve();

function trim(): void {
  for (const [key, entry] of decoded) {
    if (bytes <= LIMIT) break;
    if (!entry.bitmap || entry.users) continue;
    decoded.delete(key); bytes -= entry.bytes; entry.bitmap.close();
  }
}
function lease(resource: RasterResource): Decoded {
  const key = `${resource.session}|${resource.id}`;
  let entry = decoded.get(key);
  if (!entry || entry.resource.version < resource.version) {
    const created: Decoded = { key, retired: false, resource, users: 0, bytes: 0, pending: Promise.resolve(null as unknown as ImageBitmap) };
    created.pending = decoding.catch(() => {}).then(() => window.api.readRasterResource(resource)).then(async (result) => {
      const bitmap = await createImageBitmap(new Blob([result.data.slice().buffer], { type: 'image/png' }));
      created.resource = result; created.bitmap = bitmap; created.bytes = bitmap.width * bitmap.height * 4;
      bytes += created.bytes; trim(); return bitmap;
    }).catch((error) => { if (decoded.get(key) === created) decoded.delete(key); throw error; });
    decoding = created.pending.then(() => {}, () => {});
    if (entry) { entry.retired = true; if (entry.bitmap && !entry.users) { bytes -= entry.bytes; entry.bitmap.close(); } }
    entry = created;
  }
  decoded.delete(key); decoded.set(key, entry); entry.users++;
  return entry;
}
function release(entry: Decoded): void {
  entry.users--;
  if (!entry.users && entry.bitmap && entry.retired) { entry.bitmap.close(); bytes -= entry.bytes; entry.bitmap = undefined; }
  trim();
}

/** Cache hits paint synchronously before first paint; misses expose no low-res substitute. */
export function drawPreparedRaster(resource: RasterResource, canvas: HTMLCanvasElement, width: number, valid: () => boolean): Promise<void> {
  const entry = lease(resource);
  const draw = (bitmap: ImageBitmap) => {
    if (!valid()) return;
    canvas.width = Math.max(1, Math.min(Math.floor(width), bitmap.width));
    canvas.height = Math.max(1, Math.round(canvas.width * bitmap.height / bitmap.width));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D 不可用');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    delete canvas.dataset.mediaPending; delete canvas.dataset.mediaError;
    canvas.dispatchEvent(new Event('mediaready', { bubbles: true }));
  };
  if (entry.bitmap) {
    try { draw(entry.bitmap); return Promise.resolve(); } finally { release(entry); }
  }
  return entry.pending.then(draw).finally(() => release(entry));
}
export async function warmPreparedRaster(resource: RasterResource): Promise<void> {
  const entry = lease(resource);
  try { await entry.pending; } finally { release(entry); }
}
export function clearDecodedRasters(): void {
  for (const [key, entry] of decoded) {
    entry.retired = true; decoded.delete(key);
    if (entry.bitmap && !entry.users) { entry.bitmap.close(); bytes -= entry.bytes; entry.bitmap = undefined; }
  }
}
