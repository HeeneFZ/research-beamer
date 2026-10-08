import { RefObject, useLayoutEffect, useState } from 'react';

/** Reveal a page only when its final image pixels are available; no blurry intermediate frame. */
export function useMediaReady(ref: RefObject<HTMLElement | null>, enabled: boolean, signature: string): boolean {
  const [ready, setReady] = useState(!enabled);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!enabled || !root) { setReady(true); return; }
    const check = () => {
      const next = !root.querySelector('[data-eps-pending]')
        && [...root.querySelectorAll('img')].every((image) => image.complete)
        && [...root.querySelectorAll('.pdf-fig canvas')].every((canvas) => {
          const element = canvas as HTMLCanvasElement;
          return !!element.closest('[data-media-error]') || element.width > 0 && !element.dataset.mediaPending;
        })
        && [...root.querySelectorAll('video')].every((video) => video.readyState >= 2 || !!video.error);
      setReady((old) => old === next ? old : next);
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-media-pending', 'data-media-error', 'src'] });
    root.addEventListener('load', check, true); root.addEventListener('error', check, true);
    root.addEventListener('loadeddata', check, true); root.addEventListener('mediaready', check);
    check();
    return () => {
      observer.disconnect(); root.removeEventListener('load', check, true); root.removeEventListener('error', check, true);
      root.removeEventListener('loadeddata', check, true); root.removeEventListener('mediaready', check);
    };
  }, [ref, enabled, signature]);
  return ready;
}
