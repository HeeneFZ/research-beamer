// Decode for this window before interaction; keep +/-5 pages warm afterwards.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '../model/types';
import type { MediaPreparation, RasterResource } from '../model/mediaResources';
import { epsTarget } from '../model/mediaGeometry';
import { absMediaPath } from '../components/paths';
import { pinScreenRasters, prepareScreenBudget, SCREEN_RASTER_LIMIT, screenRasterReady, warmScreenRaster } from '../components/resourceRaster';
import { warmGifAnimation } from '../components/GifAnimation';

export function useScreenPreparation(pages: Page[], current: number, folder: string, preparation: MediaPreparation | undefined, displayWidth: number, displayHeight: number, enabled = true, logicalWidth = 160 * 96 / 25.4) {
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    const resolution = window.matchMedia(`(resolution: ${dpr}dppx)`);
    resolution.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => { resolution.removeEventListener('change', update); window.removeEventListener('resize', update); };
  }, [dpr]);
  const physicalWidth = displayWidth * dpr, physicalHeight = displayHeight * dpr;
  const session = preparation?.session ?? '';
  const [status, setStatus] = useState({ session: '', ready: false, completed: 0, total: 0 });
  const [animations, setAnimations] = useState({ session: '', ready: false, completed: 0, total: 0 });
  const animationPlan = Object.entries(preparation?.gifWidths ?? {}).map(([abs, width]) => ({ abs, width: Math.max(1, Math.ceil(width * physicalWidth / logicalWidth / 128) * 128) }));
  const animationSignature = JSON.stringify(animationPlan);
  useEffect(() => {
    if (!enabled || !preparation || preparation.phase === 'waiting' || physicalWidth <= 0) return;
    let alive = true, completed = 0;
    const abort = new AbortController();
    const total = animationPlan.length;
    const publish = (ready: boolean) => { if (alive) setAnimations({ session, ready, completed, total }); };
    publish(false);
    void Promise.all(animationPlan.map(async ({ abs, width }) => {
      await warmGifAnimation(abs, Number(session), width, abort.signal).catch(() => undefined);
      completed++; publish(completed === total);
    })).then(() => publish(true));
    return () => { alive = false; abort.abort(); };
  }, [enabled, session, animationSignature, physicalWidth > 0, preparation?.phase === 'waiting']);
  const plan = useMemo(() => {
    if (!preparation || physicalWidth <= 0 || physicalHeight <= 0) return null;
    const pageResources = pages.map((page) => {
      const resources: RasterResource[] = [];
      for (const block of page.slide?.blocks ?? []) {
        if (!block.src) continue;
        const abs = absMediaPath(folder, block.src);
        const target = /\.eps$/i.test(block.src) ? epsTarget(abs) : abs;
        const resource = target ? preparation.resources[target] : undefined;
        if (resource) resources.push(resource);
      }
      return resources;
    });
    const near = [current];
    for (let distance = 1; distance <= 5; distance++) near.push(current + distance, current - distance);
    const ordered = [...near, ...pages.map((_, i) => i)];
    const seen = new Set<string>();
    const requests = ordered.flatMap((index, position) => (pageResources[index] ?? []).flatMap((resource) => {
      if (seen.has(resource.id)) return [];
      seen.add(resource.id);
      // Retain the final high-DPI raster, independent of monitor scaling.
      const width = resource.width;
      return [{ resource, width, near: position < near.length }];
    }));
    const cost = requests.reduce((sum, request) => sum + request.width * Math.round(request.width / request.resource.aspect) * 4, 0);
    return { requests, cost };
  }, [pages, current, folder, preparation, physicalWidth, physicalHeight]);
  const signature = JSON.stringify(plan?.requests.map(({ resource, width, near }) => [resource.id, resource.version, width, near]));

  useEffect(() => {
    if (!enabled || !plan || preparation?.phase !== 'ready') return;
    let alive = true;
    pinScreenRasters(plan.requests.filter((request) => request.near));
    if (plan.requests.every((request) => screenRasterReady(request.resource, request.width))) {
      if (status.session !== session || !status.ready) setStatus({ session, ready: true, completed: plan.requests.length, total: plan.requests.length });
      return;
    }
    void (async () => {
      await prepareScreenBudget();
      if (!alive) return;
      pinScreenRasters(plan.requests.filter((request) => request.near));
      const fits = plan.cost <= SCREEN_RASTER_LIMIT;
      let completed = 0;
      const publish = (ready: boolean) => {
        if (alive) setStatus((previous) => ({ session, ready: ready || (previous.session === session && previous.ready), completed, total: plan.requests.length }));
      };
      publish(false);
      for (const request of plan.requests) {
        if (!alive) return;
        if (!fits && !request.near) publish(true);
        await warmScreenRaster(request.resource, request.width, request.near ? 10 : 30).catch(() => undefined);
        completed++; publish(false);
      }
      publish(true);
    })();
    return () => { alive = false; };
  }, [enabled, signature, session, preparation?.phase]);

  const lastScale = useRef({ width: 0, height: 0 });
  useEffect(() => {
    if (!enabled || lastScale.current.width === physicalWidth && lastScale.current.height === physicalHeight) return;
    lastScale.current = { width: physicalWidth, height: physicalHeight };
    window.dispatchEvent(new Event('raster-scale'));
  }, [enabled, physicalWidth, physicalHeight]);
  return { completed: status.completed + animations.completed, total: status.total + animations.total,
    ready: preparation?.phase === 'ready' && status.session === session && status.ready && animations.session === session && animations.ready };
}
