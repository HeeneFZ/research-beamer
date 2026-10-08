// Only the static thumbnail tree solves layout; visible modes read the same result.
// Content/font/media geometry are inputs. Focus, navigation, DPR and raster DPI are not.
import { RefObject, useLayoutEffect } from 'react';
import { useStore } from '../../state/store';
import { compressBest, layoutCssVars, FIT_TOL, LayoutSpec, SpacingState } from '../../model/layoutSpec';

const PROBE_VARS = ['--lh', '--gap-para', '--gap-item', '--img-max-h', '--body-fit'];

export function useLayoutScan(
  ref: RefObject<HTMLElement | null>, key: string | null,
  enabled: boolean, signature: string, spec: LayoutSpec | null,
): void {
  useLayoutEffect(() => {
    if (!enabled || !key || !spec || !ref.current) return;
    if (useStore.getState().pageLayout[key]?.signature === signature) return;
    const el = ref.current;
    const annotations = [...el.querySelectorAll<HTMLElement>('.ae-wrap')];
    let disposed = false;
    let finished = false;
    let timer = 0;
    const refreshAnnotations = () => annotations.forEach((wrap) => wrap.dispatchEvent(new Event('layoutprobe')));
    const apply = (state: SpacingState) => {
      const vars = layoutCssVars(spec, state);
      for (const name of PROBE_VARS) el.style.setProperty(name, vars[name]);
      refreshAnnotations();
    };
    const tick = () => {
      if (disposed || finished) return;
      // Flush style so first-use fonts have been requested before testing readiness.
      void el.offsetHeight;
      if (el.querySelector('[data-layout-pending], [data-eps-pending]')
        || [...el.querySelectorAll('img')].some((image) => !image.complete)
        || [...el.querySelectorAll('video')].some((video) => video.readyState === 0 && !video.error)
        || document.fonts?.status === 'loading') return;
      const { st, over } = compressBest(spec, (state) => {
        apply(state);
        return el.scrollHeight - el.clientHeight;
      });
      apply(st);
      finished = true;
      useStore.getState().setPageLayout(key, { ...st, signature });
      for (const name of PROBE_VARS) el.style.removeProperty(name);
      if (over > FIT_TOL) useStore.getState().setFlashMsg('内容超出页面（字号已到排版下限），建议删减或分页');
    };
    const schedule = () => {
      if (finished || disposed || timer) return;
      timer = window.setTimeout(() => { timer = 0; tick(); }, 0);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-layout-pending'] });
    el.addEventListener('load', schedule, true);
    el.addEventListener('error', schedule, true);
    el.addEventListener('loadedmetadata', schedule, true);
    document.fonts?.addEventListener('loadingdone', schedule);
    document.fonts?.addEventListener('loadingerror', schedule);
    tick(); // Loaded geometry is solved before React's first paint, with no candidate frames.
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      el.removeEventListener('load', schedule, true);
      el.removeEventListener('error', schedule, true);
      el.removeEventListener('loadedmetadata', schedule, true);
      document.fonts?.removeEventListener('loadingdone', schedule);
      document.fonts?.removeEventListener('loadingerror', schedule);
    };
  }, [ref, key, enabled, signature, spec]);
}
