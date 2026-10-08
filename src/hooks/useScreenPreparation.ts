// Decode for this window before interaction; keep +/-5 pages warm afterwards.
import { useEffect, useMemo, useState } from 'react';
import type { Page } from '../model/types';
import type { MediaPreparation, RasterResource } from '../model/mediaResources';
import { epsTarget } from '../model/mediaGeometry';
import { absMediaPath } from '../components/paths';
import { pinScreenRasters, SCREEN_RASTER_LIMIT, screenRasterReady, screenRasterWidth, warmScreenRaster } from '../components/resourceRaster';

export function useScreenPreparation(pages: Page[], current: number, folder: string, preparation: MediaPreparation | undefined, displayWidth: number, displayHeight: number) {
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
      // A figure cannot exceed the page in either dimension; avoid allocating a
      // page-wide raster of a very tall/narrow PDF.
      const width = screenRasterWidth(resource, Math.min(physicalWidth, physicalHeight * resource.aspect));
      return [{ resource, width, near: position < near.length }];
    }));
    const cost = requests.reduce((sum, request) => sum + request.width * Math.round(request.width / request.resource.aspect) * 4, 0);
    return { requests, fits: cost <= SCREEN_RASTER_LIMIT };
  }, [pages, current, folder, preparation, physicalWidth, physicalHeight]);
  const signature = JSON.stringify(plan?.requests.map(({ resource, width, near }) => [resource.id, resource.version, width, near]));

  useEffect(() => {
    if (!plan || preparation?.phase !== 'ready') return;
    let alive = true;
    pinScreenRasters(plan.requests.filter((request) => request.near));
    if (plan.requests.every((request) => screenRasterReady(request.resource, request.width))) {
      if (status.session !== session || !status.ready) setStatus({ session, ready: true, completed: plan.requests.length, total: plan.requests.length });
      return;
    }
    void (async () => {
      let completed = 0;
      const publish = (ready: boolean) => {
        if (alive) setStatus((previous) => ({ session, ready: ready || (previous.session === session && previous.ready), completed, total: plan.requests.length }));
      };
      publish(false);
      for (const request of plan.requests) {
        if (!alive) return;
        if (!plan.fits && !request.near) publish(true);
        await warmScreenRaster(request.resource, request.width, request.near ? 10 : 30).catch(() => undefined);
        completed++; publish(false);
      }
      publish(true);
    })();
    return () => { alive = false; };
  }, [signature, session, preparation?.phase]);

  useEffect(() => { window.dispatchEvent(new Event('raster-scale')); }, [physicalWidth, physicalHeight]);
  return { ...status, ready: preparation?.phase === 'ready' && status.session === session && status.ready };
}
