// Foreground pages become usable first; remaining resources stay in RAM when prepared.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Page } from '../model/types';
import type { MediaPreparation, RasterResource } from '../model/mediaResources';
import { preparationOrder } from '../model/preparation';
import { epsTarget } from '../model/mediaGeometry';
import { absMediaPath } from '../components/paths';
import { pinScreenRasters, prepareScreenBudget, prioritizeScreenRaster, screenRasterReady, warmScreenRaster } from '../components/resourceRaster';
import { warmGifAnimation, prioritizeGifAnimation, gifAnimationReady } from '../components/GifAnimation';
import { displayPagePixels } from '../components/displayTargets';

interface Task { controller: AbortController; done: boolean; failed?: boolean }
interface Request { key: string; abs: string; width: number; resource?: RasterResource }

export function useScreenPreparation(pages: Page[], current: number, folder: string, preparation: MediaPreparation | undefined, displayWidth: number, displayHeight: number, enabled = true, logicalWidth = 160 * 96 / 25.4, firstTen = false, background = true, owner = '') {
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [targetWidth, setTargetWidth] = useState(0);
  useEffect(() => { void displayPagePixels().then(setTargetWidth); }, []);
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    query.addEventListener('change', update); window.addEventListener('resize', update);
    return () => { query.removeEventListener('change', update); window.removeEventListener('resize', update); };
  }, [dpr]);
  const session = preparation?.session ?? '';
  const gifRevision = Number(session.slice(session.lastIndexOf(':') + 1));
  const scope = `${owner}|${session}`;
  const tasks = useRef(new Map<string, Task>());
  const epoch = useRef(0);
  const [status, setStatus] = useState({ session: '', ready: false, completed: 0, total: 0 });
  const order = preparationOrder(pages.length, current, firstTen && !(status.session === scope && status.ready));
  const front = new Set(order.front);
  const requests = new Map<string, Request>(), required = new Set<string>();
  let missing = false;
  const failedPreparation = !!preparation?.errors.__prepare__;
  for (const index of order.all) {
    if (failedPreparation) continue;
    if (!background && !front.has(index)) continue;
    const page = pages[index];
    if (!page.slide || !['content', 'twoCol'].includes(page.slide.layout)) continue;
    for (const block of page.slide.blocks) {
      if (!block.src || !['figure', 'video'].includes(block.type)) continue;
      const abs = absMediaPath(folder, block.src);
      if (preparation?.errors[abs]) continue;
      let request: Request | undefined;
      if (/\.gif$/i.test(abs)) {
        const logical = preparation?.gifWidths?.[abs];
        if (logical && targetWidth) {
          const width = Math.max(1, Math.ceil(logical * targetWidth / logicalWidth / 128) * 128);
          request = { key: `gif|${session}|${abs}|${width}`, abs, width };
        } else if (front.has(index)) missing = true;
      } else if (/\.(pdf|eps)$/i.test(abs)) {
        const target = /\.eps$/i.test(abs) ? preparation?.epsTargets?.[abs] !== undefined ? preparation.epsTargets[abs] : epsTarget(abs) : abs;
        if (target === null) continue;
        const resource = target ? preparation?.resources[target] : undefined;
        if (resource) request = { key: `pdf|${session}|${resource.id}|${resource.version}`, abs, width: resource.width, resource };
        else if (front.has(index) && !(target && preparation?.errors[target])) missing = true;
      }
      if (request) { requests.set(request.key, request); if (front.has(index)) required.add(request.key); }
    }
  }
  const plan = [...requests.values()];
  const latest = useRef({ session, scope, plan, required, missing, phase: preparation?.phase });
  latest.current = { session, scope, plan, required, missing, phase: preparation?.phase };
  const publish = () => {
    const value = latest.current;
    const completed = value.plan.filter((request) => tasks.current.get(request.key)?.done).length;
    const ready = value.phase === 'ready' && !value.missing && [...value.required].every((key) => tasks.current.get(key)?.done);
    setStatus((old) => {
      const next = { session: value.scope, ready: ready || old.session === value.scope && old.ready, completed, total: value.plan.length };
      return old.session === next.session && old.ready === next.ready && old.completed === next.completed && old.total === next.total ? old : next;
    });
  };
  useEffect(() => {
    epoch.current++;
    for (const task of tasks.current.values()) task.controller.abort();
    tasks.current.clear();
    return () => {
      epoch.current++;
      for (const task of tasks.current.values()) task.controller.abort();
      tasks.current.clear();
    };
  }, [scope]);
  const signature = JSON.stringify(plan.map((request) => [request.key, required.has(request.key)]));
  useEffect(() => {
    if (!enabled || !preparation || preparation.phase === 'waiting') return;
    const generation = epoch.current;
    const keys = new Set(plan.map((request) => request.key));
    for (const [key, task] of tasks.current) if (!keys.has(key)) { task.controller.abort(); tasks.current.delete(key); }
    pinScreenRasters(plan.filter((request) => request.resource && required.has(request.key)).map((request) => ({ resource: request.resource!, width: request.width })));
    for (const request of plan) {
      const priority = required.has(request.key) ? 0 : 30;
      const old = tasks.current.get(request.key);
      if (old) {
        const resident = request.resource ? screenRasterReady(request.resource, request.width) : gifAnimationReady(request.abs, gifRevision, request.width);
        if (!old.done || old.failed || resident || !required.has(request.key)) {
          if (priority === 0) {
            if (request.resource) prioritizeScreenRaster(request.resource);
            else prioritizeGifAnimation(request.abs, gifRevision);
          }
          continue;
        }
        tasks.current.delete(request.key);
      }
      const task: Task = { controller: new AbortController(), done: !!request.resource && screenRasterReady(request.resource, request.width) };
      tasks.current.set(request.key, task);
      if (task.done) continue;
      const pending = request.resource
        ? prepareScreenBudget().then(() => warmScreenRaster(request.resource!, request.width, priority))
        : warmGifAnimation(request.abs, gifRevision, request.width, task.controller.signal, priority);
      void pending.catch(() => { task.failed = true; }).then(() => {
        if (epoch.current !== generation || tasks.current.get(request.key) !== task) return;
        task.done = true; publish();
      });
    }
    publish();
    // Existing decodes survive navigation and monitor changes. Only the session cancels them.
  }, [enabled, scope, targetWidth, signature, missing, preparation?.phase]);
  const physicalWidth = displayWidth * dpr, physicalHeight = displayHeight * dpr;
  const lastScale = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!enabled || lastScale.current.width === physicalWidth && lastScale.current.height === physicalHeight) return;
    lastScale.current = { width: physicalWidth, height: physicalHeight };
    window.dispatchEvent(new Event('raster-scale'));
  }, [enabled, physicalWidth, physicalHeight]);
  return { completed: status.completed, total: status.total, ready: status.session === scope && status.ready };
}
