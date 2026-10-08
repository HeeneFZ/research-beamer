import { useEffect } from 'react';
import { useStore } from '../state/store';
import { MediaPreparation, mediaAssetSignature } from '../model/mediaResources';
import { epsTarget, mediaFailure, rememberMediaAspect, rememberMediaFailure } from '../model/mediaGeometry';
import { absMediaPath } from '../components/paths';
import { fileUrl, preparePdfRaster, releaseUnusedPdfDocuments } from '../components/pdfRaster';
import { clearDecodedRasters, warmPreparedRaster } from '../components/resourceRaster';

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
  useEffect(() => { clearDecodedRasters(); releaseUnusedPdfDocuments(); }, [revision]);
  useEffect(() => {
    let cancelled = false;
    const session = String(revision);
    const run = async () => {
      await window.api.beginRasterSession(session);
      // Media may be replaced while editing; old ready records stay useful within a session.
      const initial = useStore.getState().mediaPreparation;
      const resources = initial.session === session ? { ...initial.resources } : {};
      const errors: Record<string, string> = {};
      while (!cancelled) {
        const state = useStore.getState();
        const roots = document.querySelectorAll('.filmstrip .sv');
        if (roots.length === state.computed.pages.length && [...roots].every((root) => root.getAttribute('data-layout-ready') === 'true')) break;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (cancelled) return;
      const assets = new Map<string, string>();
      if (deck.config.logo) assets.set(absMediaPath(folder ?? '', deck.config.logo), 'image');
      for (const item of deck.items) if (item.kind === 'slide') for (const block of item.slide.blocks) {
        if (!block.src || !['figure', 'video'].includes(block.type)) continue;
        const abs = absMediaPath(folder ?? '', block.src);
        assets.set(abs, block.type === 'video' ? 'video' : block.src.toLowerCase().endsWith('.pdf') ? 'pdf' : block.src.toLowerCase().endsWith('.eps') ? 'eps' : 'image');
      }
      let completed = 0;
      const publish = (phase: MediaPreparation['phase']) => {
        if (!cancelled && useStore.getState().mediaRevision === revision) useStore.getState().setMediaPreparation({ session, phase, completed, total: assets.size, resources: { ...resources }, errors: { ...errors }, assetSignature });
      };
      const needed = [...assets].some(([abs, kind]) => (kind === 'pdf' || kind === 'eps') && !resources[kind === 'eps' ? epsTarget(abs) ?? abs : abs]);
      if (!needed && initial.phase === 'ready' && initial.assetSignature === assetSignature) return;
      publish('preparing');
      // Native pictures retain their original encoding/animation; preload is bounded to two.
      const native = [...assets].filter(([, kind]) => kind === 'image');
      let cursor = 0;
      await Promise.all([0, 1].map(async () => {
        while (!cancelled && cursor < native.length) {
          const [abs] = native[cursor++];
          try { if (mediaFailure(abs)) throw new Error(mediaFailure(abs)); await preloadImage(abs, revision); }
          catch (error) { errors[abs] = String(error); }
          completed++; publish('preparing');
        }
      }));
      for (const [abs, kind] of assets) {
        if (cancelled) return;
        if (kind === 'image') continue;
        if (kind === 'video') { completed++; continue; } // Static video nodes already waited for metadata/data.
        const target = kind === 'eps' ? epsTarget(abs) : abs;
        try {
          if (!target) throw new Error('EPS 转换失败');
          if (mediaFailure(target)) throw new Error(mediaFailure(target));
          resources[target] ??= await preparePdfRaster(target, session);
        } catch (error) { errors[abs] = String(error); }
        completed++; publish('preparing');
      }
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

export function useWarmAdjacentPages(): void {
  const current = useStore((state) => state.current);
  const computed = useStore((state) => state.computed);
  const folder = useStore((state) => state.folder);
  const preparation = useStore((state) => state.mediaPreparation);
  const adjacent = JSON.stringify([current - 1, current + 1].flatMap((index) => computed.pages[index]?.slide?.blocks.filter((block) => block.src).map((block) => block.src) ?? []));
  useEffect(() => {
    if (preparation.phase !== 'ready') return;
    let alive = true;
    void (async () => {
      for (const index of [current - 1, current + 1]) for (const block of computed.pages[index]?.slide?.blocks ?? []) {
        if (!alive || !block.src) continue;
        const abs = absMediaPath(folder ?? '', block.src), target = block.src.toLowerCase().endsWith('.eps') ? epsTarget(abs) : abs;
        const resource = target ? preparation.resources[target] : undefined;
        if (resource) await warmPreparedRaster(resource).catch(() => undefined);
      }
    })();
    return () => { alive = false; };
  }, [adjacent, folder, preparation]);
}
