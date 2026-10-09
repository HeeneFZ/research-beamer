import { RefObject, useLayoutEffect, useState } from 'react';

export function pageMediaReady(root: HTMLElement): boolean {
  return ![...root.querySelectorAll('[data-eps-pending], [data-media-pending]')].some((node) => !node.closest('[data-media-error]'))
    && [...root.querySelectorAll('img')].every((image) => image.complete)
    && [...root.querySelectorAll('.pdf-fig canvas')].every((canvas) => !!canvas.closest('[data-media-error]') || (canvas as HTMLCanvasElement).width > 0)
    && [...root.querySelectorAll('video')].every((video) => video.readyState >= 2 || !!video.error);
}
/** Reveal a page only when its final image pixels are available; no blurry intermediate frame. */
export function useMediaReady(ref: RefObject<HTMLElement | null>, enabled: boolean, signature: string): boolean {
  const [ready, setReady] = useState(!enabled);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!enabled || !root) { setReady(true); return; }
    let alive = true;
    const decoding = new WeakSet<HTMLImageElement>();
    const check = () => {
      for (const image of root.querySelectorAll('img')) {
        if (!image.complete || !image.naturalWidth || decoding.has(image)) continue;
        decoding.add(image); image.dataset.mediaPending = 'true';
        // A retained page owns its native image decode as well as its DOM. Some
        // animated images reject decode() despite being usable; onload is the fallback.
        void image.decode().catch(() => undefined).then(() => {
          if (!alive) return;
          delete image.dataset.mediaPending; check();
        });
      }
      const next = pageMediaReady(root);
      setReady((old) => old === next ? old : next);
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-media-pending', 'data-media-error', 'src'] });
    root.addEventListener('load', check, true); root.addEventListener('error', check, true);
    root.addEventListener('loadeddata', check, true); root.addEventListener('mediaready', check);
    check();
    return () => {
      alive = false;
      for (const image of root.querySelectorAll('img')) delete image.dataset.mediaPending;
      observer.disconnect(); root.removeEventListener('load', check, true); root.removeEventListener('error', check, true);
      root.removeEventListener('loadeddata', check, true); root.removeEventListener('mediaready', check);
    };
  }, [ref, enabled, signature]);
  return ready;
}
