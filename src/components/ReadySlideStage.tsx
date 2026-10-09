// Prepare a bounded pool once, then switch visibility without rebuilding page DOM.
// Small decks fit in the pool; larger decks prioritise the current +/-5 pages.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SlideView, referenceSignature } from './SlideView';
import type { SlideViewProps } from './slide/types';
import type { Page } from '../model/types';
import type { ViewPreparation } from '../model/mediaResources';
import { pageMediaReady } from './slide/useMediaReady';

const EMPTY_REVEALED = new Set<number>();
const PAGE_CACHE_LIMIT = 32;
const pageKey = (page: Page) => page.slide?.id ?? page.section?.id ?? page.no;

export function ReadySlideStage({ preloadPages, onPrepared, onPreparation, preparationKey, active: viewActive = true, ...props }: SlideViewProps & { preloadPages?: Page[]; onPrepared?: (ready: boolean) => void; onPreparation?: (state: ViewPreparation) => void; preparationKey?: string; active?: boolean }) {
  const revision = useStore((state) => props.mediaSnapshot ?? state.mediaRevision);
  const layouts = useStore((state) => props.layoutSnapshot ?? state.pageLayout);
  const resources = useStore((state) => props.resourceSnapshot ?? state.mediaPreparation);
  const scope = String(props.mediaSnapshot ?? revision);
  const identity = `${scope}|${pageKey(props.page)}`;
  const [active, setActive] = useState<string | null>(null);
  const [pool, setPool] = useState<string[]>([]);
  const [painting, setPainting] = useState<string | null>(null);
  const [readinessTick, setReadinessTick] = useState(0);
  const [progress, setProgress] = useState({ scope: '', ready: false, completed: 0, total: 0 });
  const snapshots = useRef(new Map<string, SlideViewProps>());
  const callbacks = useRef(new Map<string, (ready: boolean) => void>());
  const readyPages = useRef(new Set<string>());
  const layers = useRef(new Map<string, HTMLDivElement>());
  const latest = useRef(identity);
  latest.current = identity;
  const snapshot = { ...props, layoutSnapshot: props.layoutSnapshot ?? layouts, resourceSnapshot: props.resourceSnapshot ?? resources, mediaSnapshot: props.mediaSnapshot ?? revision };
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  snapshots.current.set(identity, snapshot);
  const current = active?.startsWith(scope + '|') ? active : null;
  const transitioning = current !== identity;
  const keys = [...new Set([...pool.filter((key) => key.startsWith(scope + '|')), ...(current ? [current] : []), identity])];
  const pages = useMemo(() => preloadPages ?? [props.page], [preloadPages, props.page]);
  const pageIds = pages.map(pageKey).join('|');
  const reference = referenceSignature(props.computed);
  const warming = progress.scope !== scope || !progress.ready;

  useEffect(() => { onPrepared?.(!warming); }, [warming, onPrepared]);
  useLayoutEffect(() => {
    const root = layers.current.get(identity)?.querySelector<HTMLElement>('.sv');
    const currentReady = !transitioning && !!root && root.dataset.slideReady === 'true' && pageMediaReady(root);
    onPreparation?.({ scope, targetKey: preparationKey ?? identity, ready: !warming, currentReady, completed: progress.completed, total: progress.total });
  }, [scope, identity, preparationKey, warming, transitioning, readinessTick, progress.completed, progress.total, onPreparation]);
  useEffect(() => {
    let alive = true;
    const index = pages.findIndex((page) => pageKey(page) === pageKey(props.page));
    const indices = [index];
    for (let distance = 1; distance <= 5; distance++) indices.push(index + distance, index - distance);
    if (pages.length <= PAGE_CACHE_LIMIT) indices.push(...pages.map((_, i) => i));
    const targets = [...new Set(indices)].flatMap((i) => pages[i] ? [pages[i]] : []);
    const missing = targets.filter((page) => {
      const key = `${scope}|${pageKey(page)}`, saved = snapshots.current.get(key);
      const stale = !saved || saved.page !== page || saved.deck.config !== props.deck.config
        || saved.folder !== props.folder || referenceSignature(saved.computed) !== reference;
      if (stale) readyPages.current.delete(key);
      return stale || !readyPages.current.has(key);
    });
    if (!missing.length) {
      if (progress.scope !== scope || !progress.ready) setProgress({ scope, ready: true, completed: targets.length, total: targets.length });
      return;
    }
    void (async () => {
      let completed = targets.length - missing.length;
      for (const page of missing) {
        if (!alive) return;
        const key = `${scope}|${pageKey(page)}`;
        const live = latestSnapshot.current;
        snapshots.current.set(key, key === latest.current ? live : { ...live, page, revealed: props.revealed ? EMPTY_REVEALED : undefined, highlightLabel: undefined });
        setPool((previous) => {
          const limit = pages.length <= PAGE_CACHE_LIMIT ? PAGE_CACHE_LIMIT : 16;
          const next = [...previous.filter((k) => k.startsWith(scope + '|') && k !== key), key];
          while (next.length > limit) {
            const victim = next.findIndex((k) => k !== latest.current && k !== active && !targets.some((p) => `${scope}|${pageKey(p)}` === k));
            if (victim < 0) break;
            const removed = next.splice(victim, 1)[0];
            snapshots.current.delete(removed); callbacks.current.delete(removed); readyPages.current.delete(removed);
          }
          return next;
        });
        while (alive && !readyPages.current.has(key)) await new Promise((resolve) => setTimeout(resolve, 20));
        if (!alive) return;
        if (warming && viewActive) {
          // Decode/layout readiness alone does not warm Chromium's first paint.
          // Paint behind the startup progress layer before releasing interaction.
          setPainting(key);
          await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
          if (!alive) return;
          setPainting(null);
        }
        completed++;
        setProgress((previous) => ({ scope, ready: previous.scope === scope && previous.ready, completed, total: targets.length }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (alive) setProgress({ scope, ready: true, completed, total: targets.length });
    })();
    return () => { alive = false; };
  }, [scope, identity, pageIds, pages, props.deck.config, reference, props.folder]);

  useLayoutEffect(() => {
    const root = layers.current.get(identity)?.querySelector<HTMLElement>('.sv');
    if (root?.dataset.slideReady === 'true' && pageMediaReady(root)) setActive(identity);
  }, [identity, layouts, resources]);

  // Deleted pages must release their DOM/media even while the pool is below its limit.
  useEffect(() => {
    const valid = new Set(pages.map((page) => `${scope}|${pageKey(page)}`));
    if (current && current !== identity) valid.add(current); // Retain the outgoing frame until handoff.
    setPool((previous) => previous.every((key) => valid.has(key)) ? previous : previous.filter((key) => valid.has(key)));
    for (const key of snapshots.current.keys()) if (!valid.has(key)) {
      snapshots.current.delete(key); callbacks.current.delete(key); readyPages.current.delete(key);
    }
  }, [scope, pageIds, current, identity]);

  return <div className="ready-slide-stage" data-stage-pending={transitioning || undefined} data-stage-warming={warming || undefined} data-stage-page={current ?? ''}>
    {keys.filter((key) => snapshots.current.has(key)).map((key) => {
      const frame = snapshots.current.get(key)!;
      let notify = callbacks.current.get(key);
      if (!notify) {
        notify = (ready) => {
          const changed = readyPages.current.has(key) !== ready;
          if (ready) readyPages.current.add(key); else readyPages.current.delete(key);
          if (changed) setReadinessTick((tick) => tick + 1);
          if (ready && latest.current === key) setActive(key);
        };
        callbacks.current.set(key, notify);
      }
      const visible = key === current;
      const animated = frame.page.slide?.blocks.some((block) => block.type === 'video' || /\.gif$/i.test(block.src ?? ''));
      return <div key={key} className="ready-slide-layer" data-stage-visible={visible || undefined} aria-hidden={!visible || undefined}
        ref={(node) => { if (node) { const inert = !viewActive || !visible || transitioning || warming; if (node.inert !== inert) node.inert = inert; layers.current.set(key, node); } else layers.current.delete(key); }}
        style={{ visibility: visible || warming && painting === key ? 'visible' : 'hidden', zIndex: warming && painting === key ? 1 : undefined, pointerEvents: !viewActive || !visible || transitioning || warming ? 'none' : undefined }}>
        <SlideView {...frame} resourceSnapshot={props.resourceSnapshot ?? resources} layoutSnapshot={props.layoutSnapshot ?? layouts}
          mediaActive={animated ? viewActive && visible && !warming : undefined} onReady={notify} />
      </div>;
    })}
  </div>;
}
