import { useEffect } from 'react';
import { useStore } from '../state/store';
import { MediaPreparation, mediaAssetSignature } from '../model/mediaResources';
import { epsTarget, mediaFailure, rememberMediaAspect, rememberMediaFailure } from '../model/mediaGeometry';
import { absMediaPath } from '../components/paths';
import { fileUrl, preparePdfRaster, releaseUnusedPdfDocuments } from '../components/pdfRaster';
import { clearDecodedRasters } from '../components/resourceRaster';
import { clearGifAnimations } from '../components/GifAnimation';
import { preparationOrder } from '../model/preparation';
import { displayPagePixels, SCREEN_SAMPLING } from '../components/displayTargets';

function preloadImage(abs: string, revision: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
        rememberMediaFailure(abs, '图片尺寸无效', revision); reject(new Error('图片尺寸无效')); return;
      }
      rememberMediaAspect(abs, image.naturalWidth / image.naturalHeight, revision);
      image.onload = image.onerror = null;
      // onload plus the static first-frame canvas establish readiness. decode() can
      // reject usable animated images after Chromium evicts their transient decode.
      resolve(); image.src = '';
    };
    image.onerror = () => { rememberMediaFailure(abs, '图片加载失败', revision); reject(new Error('图片加载失败')); };
    image.src = fileUrl(abs);
  });
}

/** The static measurement tree establishes geometry, then unique final assets are prepared. */
export function useMediaPreparation(): void {
  const revision = useStore((state) => state.mediaRevision);
  const deck = useStore((state) => state.deck);
  const folder = useStore((state) => state.folder);
  const assetSignature = mediaAssetSignature(deck);
  useEffect(() => { clearDecodedRasters(); clearGifAnimations(revision); releaseUnusedPdfDocuments(); }, [revision]);
  useEffect(() => {
    let cancelled = false;
    const session = String(revision);
    const run = async () => {
      await window.api.beginRasterSession(session);
      const displayPixels = await displayPagePixels();
      // Media may be replaced while editing; old ready records stay useful within a session.
      const initial = useStore.getState().mediaPreparation;
      const resources = initial.session === session ? { ...initial.resources } : {};
      const errors: Record<string, string> = {};
      while (!cancelled) {
        const state = useStore.getState();
        const front = preparationOrder(state.computed.pages.length, state.current, true).front;
        if (front.every((i) => document.querySelector(`.filmstrip .sv[data-page-index="${i}"]`)?.getAttribute('data-layout-ready') === 'true')) break;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (cancelled) return;
      const gifWidths: Record<string, number> = {};
      const collectGifWidths = () => {
        for (const canvas of document.querySelectorAll<HTMLElement>('.filmstrip .sv[data-layout-ready="true"] [data-gif-source]')) {
          const abs = canvas.dataset.gifSource!, width = canvas.parentElement?.clientWidth ?? 0;
          if (width > 0) gifWidths[abs] = Math.max(gifWidths[abs] ?? 0, width);
        }
      };
      collectGifWidths();
      const assets = new Map<string, string>();
      if (deck.config.logo) assets.set(absMediaPath(folder ?? '', deck.config.logo), 'image');
      for (const item of deck.items) if (item.kind === 'slide' && ['content', 'twoCol'].includes(item.slide.layout)) for (const block of item.slide.blocks) {
        if (!block.src || !['figure', 'video'].includes(block.type)) continue;
        const abs = absMediaPath(folder ?? '', block.src);
        assets.set(abs, block.type === 'video' ? 'video' : block.src.toLowerCase().endsWith('.pdf') ? 'pdf' : block.src.toLowerCase().endsWith('.eps') ? 'eps' : 'image');
      }
      let completed = 0;
      const done = new Set<string>(), started = new Set<string>();
      const pageAssets = useStore.getState().computed.pages.map((page) => new Set((page.slide && ['content', 'twoCol'].includes(page.slide.layout) ? page.slide.blocks : []).filter((block) => block.src).map((block) => absMediaPath(folder ?? '', block.src!))));
      const first = new Set(preparationOrder(pageAssets.length, useStore.getState().current, true).front.flatMap((i) => [...pageAssets[i]]));
      if (deck.config.logo) first.add(absMediaPath(folder ?? '', deck.config.logo));
      const foregroundReady = () => [...first].every((abs) => !assets.has(abs) || done.has(abs));
      const publish = (_phase: MediaPreparation['phase']) => {
        collectGifWidths();
        const phase = foregroundReady() ? 'ready' : 'preparing';
        if (!cancelled && useStore.getState().mediaRevision === revision) useStore.getState().setMediaPreparation({ session, phase, completed, total: assets.size, resources: { ...resources }, errors: { ...errors }, assetSignature, gifWidths: { ...gifWidths } });
      };
      const needed = [...assets].some(([abs, kind]) => (kind === 'pdf' || kind === 'eps') && !resources[kind === 'eps' ? epsTarget(abs) ?? abs : abs]);
      if (!needed && initial.phase === 'ready' && initial.assetSignature === assetSignature) return;
      publish('preparing');
      const take = (native: boolean) => {
        const current = useStore.getState().current;
        const near = new Set(preparationOrder(pageAssets.length, current).front.flatMap((i) => [...pageAssets[i]]));
        let selected: [string, string] | undefined, best = Infinity;
        for (const item of assets) {
          const [abs, kind] = item;
          if (started.has(abs) || (kind === 'image') !== native) continue;
          const score = pageAssets[current]?.has(abs) ? 0 : !foregroundReady() && first.has(abs) ? 1 : near.has(abs) ? 2 : 3;
          if (score < best) { selected = item; best = score; }
        }
        if (selected) started.add(selected[0]);
        return selected;
      };
      await Promise.all([true, true, false, false].map(async (native) => {
        let item: [string, string] | undefined;
        while (!cancelled && (item = take(native))) {
          const [abs, kind] = item;
          try {
            if (native) {
              if (mediaFailure(abs)) throw new Error(mediaFailure(abs));
              if (/\.gif$/i.test(abs)) {
                while (!cancelled && !gifWidths[abs] && !mediaFailure(abs)) {
                  collectGifWidths();
                  if (!gifWidths[abs]) await new Promise((resolve) => setTimeout(resolve, 40));
                }
                if (mediaFailure(abs)) throw new Error(mediaFailure(abs));
              } else await preloadImage(abs, revision);
            } else if (kind !== 'video') {
              const target = kind === 'eps' ? epsTarget(abs) : abs;
              if (!target) throw new Error('EPS 转换失败');
              if (mediaFailure(target)) throw new Error(mediaFailure(target));
              resources[target] = await preparePdfRaster(target, session, displayPixels * SCREEN_SAMPLING, 1);
            }
          }
          catch (error) { errors[abs] = String(error); }
          done.add(abs);
          completed++; publish('preparing');
        }
      }));
      publish('ready');
    };
    void run().catch((error) => {
      if (!cancelled) {
        useStore.getState().setFlashMsg('资源预备失败：' + String(error));
        useStore.getState().setMediaPreparation({ session, phase: 'ready', completed: 0, total: 0, resources: {}, errors: { __prepare__: String(error) } });
      }
    });
    return () => { cancelled = true; };
  }, [revision, folder, assetSignature]);
}
