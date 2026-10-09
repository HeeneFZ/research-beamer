// Prepared GIF frames live in RAM until project change or budget eviction.
// Shared frames survive editor/monitor switching; playback never decodes a GIF.
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { mediaAspect } from '../model/mediaGeometry';
import { fileUrl } from './pdfRaster';
interface Frame { raster: ImageData; duration: number }
interface Animation { key: string; id: number; worker: Worker; width: number; aspect: number; loops: number; duration: number; frames: Frame[]; bytes: number; users: number; retired: boolean; done: boolean; pending: Promise<void>; resolve: () => void; reject: (error: Error) => void }
interface Message { type: 'metadata' | 'frame' | 'prepared' | 'error'; id: number; data?: ArrayBuffer; height?: number; duration?: number; width?: number; aspect?: number; loops?: number; bytes?: number; error?: string }
const WORKER_COUNT = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
const workers: (Worker | null)[] = Array(WORKER_COUNT).fill(null);
let session = -1, nextId = 0, bytes = 0;
let budget: Promise<number> | null = null;
const cache = new Map<string, Animation>(), requests = new Map<number, Animation>();
function close(entry: Animation): void {
  if (!entry.done && requests.get(entry.id) === entry) {
    requests.delete(entry.id); entry.worker.postMessage({ type: 'remove', id: entry.id }); entry.reject(new Error('资源请求已取消'));
  }
  entry.frames = []; bytes -= entry.bytes; entry.bytes = 0;
}
function room(cost: number): void {
  for (const [key, entry] of cache) {
    if (entry.users || !entry.done) continue;
    cache.delete(key); close(entry);
    if (bytes + cost <= memoryLimit) break;
  }
}
let memoryLimit = 1024 ** 3;
export function clearGifAnimations(revision?: number): void {
  if (revision != null && session === revision) return;
  workers.forEach((worker) => worker?.terminate()); workers.fill(null);
  for (const entry of new Set([...cache.values(), ...requests.values()])) {
    entry.retired = true; if (!entry.done) entry.reject(new Error('资源会话已结束')); if (!entry.users) close(entry);
  }
  cache.clear(); requests.clear(); session = revision ?? -1;
}
function decoderWorker(revision: number): Worker {
  if (session !== revision) clearGifAnimations(revision);
  const counts = workers.map((worker) => [...requests.values()].filter((entry) => entry.worker === worker).length);
  const index = counts.indexOf(Math.min(...counts));
  let worker = workers[index];
  if (!worker) {
    budget ??= window.api.displayMemoryBudget();
    worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
    workers[index] = worker;
    const instance = worker;
    worker.onmessage = async ({ data }: MessageEvent<Message>) => {
      const entry = requests.get(data.id);
      if (!entry) return;
      if (data.type === 'metadata') {
        memoryLimit = await budget!;
        if (requests.get(data.id) !== entry) return;
        const cost = data.bytes!;
        if (bytes + cost > memoryLimit) room(cost);
        if (bytes + cost > memoryLimit) {
          instance.postMessage({ type: 'allow', id: data.id, allowed: false });
          requests.delete(data.id); if (cache.get(entry.key) === entry) cache.delete(entry.key);
          entry.reject(new Error('动画缓存超过内存预算')); return;
        }
        entry.bytes = cost; bytes += cost; entry.width = Math.max(entry.width, data.width!); entry.aspect = data.aspect!; entry.loops = data.loops!;
        instance.postMessage({ type: 'allow', id: data.id, allowed: true });
      } else if (data.type === 'frame') entry.frames.push({ raster: new ImageData(new Uint8ClampedArray(data.data!), data.width!, data.height!), duration: data.duration! });
      else {
        requests.delete(data.id);
        if (data.type === 'prepared') { entry.duration = entry.frames.reduce((sum, frame) => sum + frame.duration, 0); entry.done = true; entry.resolve(); }
        else { entry.retired = true; if (cache.get(entry.key) === entry) cache.delete(entry.key); entry.reject(new Error(data.error)); if (!entry.users) close(entry); }
      }
    };
    worker.onerror = (event) => {
      for (const entry of [...requests.values()]) {
        if (entry.worker !== instance) continue;
        entry.retired = true; if (cache.get(entry.key) === entry) cache.delete(entry.key);
        requests.delete(entry.id);
        entry.reject(new Error(event.message)); if (!entry.users) close(entry);
      }
      instance.terminate(); if (workers[index] === instance) workers[index] = null;
    };
  }
  return worker;
}
function lease(abs: string, revision: number, width: number): Animation {
  if (session !== revision) clearGifAnimations(revision);
  const key = revision + '|' + abs;
  let entry = cache.get(key);
  if (!entry || entry.width < width) {
    const instance = decoderWorker(revision);
    if (entry) { entry.retired = true; if (!entry.users) close(entry); }
    let resolve!: () => void, reject!: (error: Error) => void;
    const pending = new Promise<void>((r, j) => { resolve = r; reject = j; });
    entry = { key, id: ++nextId, worker: instance, width, aspect: mediaAspect(abs) ?? 0, loops: Infinity, duration: 0, frames: [], bytes: 0, users: 0, retired: false, done: false, pending, resolve, reject };
    requests.set(entry.id, entry); cache.set(key, entry);
    instance.postMessage({ type: 'prepare', id: entry.id, url: fileUrl(abs), width, aspect: entry.aspect });
  }
  cache.delete(key); cache.set(key, entry); entry.users++;
  return entry;
}
function release(entry: Animation): void {
  entry.users--;
  if (!entry.users && !entry.done) { entry.retired = true; if (cache.get(entry.key) === entry) cache.delete(entry.key); }
  if (!entry.users && entry.retired) close(entry);
}
export async function warmGifAnimation(abs: string, revision: number, width: number, signal?: AbortSignal): Promise<void> {
  const entry = lease(abs, revision, width);
  let released = false;
  const free = () => { if (!released) { released = true; release(entry); } };
  signal?.addEventListener('abort', free, { once: true });
  if (signal?.aborted) free();
  try { await entry.pending; } finally { signal?.removeEventListener('abort', free); free(); }
}

export function GifAnimation({ abs, active = true, onAspect, onError }: { abs: string; active?: boolean; onAspect: (aspect: number) => void; onError: () => void }) {
  const revision = useStore((state) => state.mediaRevision), canvasRef = useRef<HTMLCanvasElement>(null);
  const control = useRef<{ setActive: (active: boolean) => void } | null>(null);
  const latest = useRef({ active, onAspect }); latest.current = { active, onAspect };
  const [fallback, setFallback] = useState(false);
  useLayoutEffect(() => {
    const canvas = canvasRef.current, box = canvas?.parentElement;
    if (!canvas || !box || fallback) return;
    let alive = true, playing = false, desiredActive = false, raf = 0, due = 0, width = 0, token = 0, index = 0, loops = 0;
    let animation: Animation | null = null;
    const pending = new Map<number, Animation>();
    const draw = (frame: Frame) => {
      const raster = frame.raster;
      if (canvas.width !== raster.width || canvas.height !== raster.height) { canvas.width = raster.width; canvas.height = raster.height; }
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas 2D 不可用');
      context.putImageData(raster, 0, 0);
    };
    const tick = (now: number) => {
      if (!playing || !alive || !animation) return;
      let frame: Frame | null = null;
      while (playing && now >= due) {
        if (index >= animation.frames.length) {
          if (Number.isFinite(animation.loops) && loops >= animation.loops) { playing = false; break; }
          index = 0; loops++;
        }
        if (!index && animation.duration > 0 && now - due >= animation.duration) {
          const missed = Math.floor((now - due) / animation.duration);
          const skipped = Number.isFinite(animation.loops) ? Math.min(missed, animation.loops - loops) : missed;
          loops += skipped; due += skipped * animation.duration;
        }
        frame = animation.frames[index++]; due += frame.duration;
      }
      if (frame) draw(frame);
      if (playing) raf = requestAnimationFrame(tick);
    };
    const setActive = (enabled: boolean) => {
      if (!animation) return;
      if (desiredActive === enabled) { if (!enabled) draw(animation.frames[0]); return; }
      desiredActive = enabled;
      playing = enabled; cancelAnimationFrame(raf);
      if (enabled) { index = 0; loops = 0; due = performance.now(); raf = requestAnimationFrame(tick); }
      else { index = 0; loops = 0; draw(animation.frames[0]); }
    };
    control.current = { setActive };
    const prepare = () => {
      const next = Math.max(1, Math.ceil(box.getBoundingClientRect().width * (window.devicePixelRatio || 1) / 128) * 128);
      if (next === width) return;
      width = next; const current = ++token;
      for (const entry of pending.values()) release(entry); pending.clear();
      const entry = lease(abs, revision, width); pending.set(current, entry);
      if (!canvas.width) canvas.dataset.mediaPending = 'true';
      void entry.pending.then(() => {
        if (!alive || current !== token) return;
        if (animation) release(animation);
        animation = entry; pending.delete(current);
        latest.current.onAspect(entry.aspect);
        draw(entry.frames[Math.min(Math.max(0, index - 1), entry.frames.length - 1)]);
        delete canvas.dataset.mediaPending; canvas.dispatchEvent(new Event('mediaready', { bubbles: true }));
        setActive(latest.current.active);
      }).catch((error) => { if (alive && current === token) { if (window.api.isE2E) console.warn('GIF_WORKER_FALLBACK', String(error)); setFallback(true); } })
        .finally(() => { if (pending.delete(current)) release(entry); });
    };
    prepare(); const resize = new ResizeObserver(prepare); resize.observe(box);
    window.addEventListener('raster-scale', prepare);
    return () => {
      alive = false; token++; cancelAnimationFrame(raf); control.current = null; resize.disconnect(); window.removeEventListener('raster-scale', prepare);
      if (animation) release(animation); for (const entry of pending.values()) release(entry); pending.clear(); canvas.width = canvas.height = 0;
    };
  }, [abs, revision, fallback]);
  useLayoutEffect(() => { control.current?.setActive(active); }, [active]);
  if (fallback) return <img src={fileUrl(abs)} draggable={false} onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) onAspect(image.naturalWidth / image.naturalHeight); else onError(); }} onError={onError} />;
  return <canvas ref={canvasRef} className="gif-animation" width={0} height={0} data-media-pending="true" />;
}
