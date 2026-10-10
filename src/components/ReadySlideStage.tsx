// Prepare a bounded pool once, then switch visibility without rebuilding page DOM.
// Small decks fit in the pool; larger decks prioritise the current +/-5 pages.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SlideView, referenceSignature } from './SlideView';
import type { SlideViewProps } from './slide/types';
import { PAGE_SIZE, type Page } from '../model/types';
import type { ViewPreparation } from '../model/mediaResources';
import { pageMediaReady } from './slide/useMediaReady';
import { pageLayoutSnapshot, pageMediaSnapshot } from './slide/pageSnapshots';
import { preparationOrder } from '../model/preparation';

const EMPTY_REVEALED = new Set<number>();
const PAGE_CACHE_LIMIT = 64;
const pageKey = (page: Page) => page.slide?.id ?? page.section?.id ?? page.no;

export function ReadySlideStage({ preloadPages, onPrepared, onPreparation, preparationKey, displayZoom, backgroundActive = true, active: viewActive = true, retainOutgoing = true, ...props }: SlideViewProps & { preloadPages?: Page[]; onPrepared?: (ready: boolean) => void; onPreparation?: (state: ViewPreparation) => void; preparationKey?: string; displayZoom?: number; backgroundActive?: boolean; active?: boolean; retainOutgoing?: boolean }) {
  const revision = useStore((state) => props.mediaSnapshot ?? state.mediaRevision);
  const layouts = useStore((state) => props.layoutSnapshot ?? state.pageLayout);
  const resources = useStore((state) => props.resourceSnapshot ?? state.mediaPreparation);
  const scope = String(props.mediaSnapshot ?? revision);
  const identity = `${scope}|${pageKey(props.page)}`;
  const [active, setActive] = useState<string | null>(null);
  const [pool, setPool] = useState<string[]>([]);
  const [readinessTick, setReadinessTick] = useState(0);
  const [progress, setProgress] = useState({ scope: '', ready: false, completed: 0, total: 0 });
  const latestProgress = useRef(progress);
  latestProgress.current = progress;
  const snapshots = useRef(new Map<string, SlideViewProps>());
  const callbacks = useRef(new Map<string, (ready: boolean) => void>());
  const readyPages = useRef(new Set<string>());
  const layers = useRef(new Map<string, HTMLDivElement>());
  const latest = useRef(identity);
  latest.current = identity;
  const activeRef = useRef(active);
  activeRef.current = active;
  const schedule = useRef<(() => void) | null>(null);
  const background = useRef(backgroundActive);
  background.current = backgroundActive;
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
    const currentReady = viewActive && !transitioning && !!root && root.dataset.slideReady === 'true' && pageMediaReady(root);
    onPreparation?.({ scope, targetKey: preparationKey ?? identity, ready: !warming, currentReady, completed: progress.completed, total: progress.total });
  }, [viewActive, scope, identity, preparationKey, warming, transitioning, readinessTick, progress.completed, progress.total, onPreparation]);
  useEffect(() => {
    let alive = true;
    let running = false;
    const stale = (page: Page) => {
      const key = `${scope}|${pageKey(page)}`, saved = snapshots.current.get(key);
      const changed = !saved || saved.page !== page || saved.deck.config !== props.deck.config
        || saved.folder !== props.folder || referenceSignature(saved.computed) !== reference;
      if (changed) readyPages.current.delete(key);
      return changed || !readyPages.current.has(key);
    };
    const run = async () => {
      if (!alive || running) return;
      running = true;
      try { while (alive && background.current) {
        const selecting = latest.current;
        const index = pages.findIndex((page) => `${scope}|${pageKey(page)}` === latest.current);
        const prepared = latestProgress.current;
        const order = preparationOrder(pages.length, index, props.mode === 'edit' && !(prepared.scope === scope && prepared.ready));
        const targets = order.all.slice(0, PAGE_CACHE_LIMIT).map((i) => pages[i]);
        const missing = targets.filter(stale);
        const frontReady = order.front.every((i) => readyPages.current.has(`${scope}|${pageKey(pages[i])}`));
        const completed = targets.length - missing.length;
        setProgress((previous) => {
          const ready = !missing.length || frontReady || previous.scope === scope && previous.ready;
          return previous.scope === scope && previous.ready === ready && previous.completed === completed && previous.total === targets.length
            ? previous : { scope, ready, completed, total: targets.length };
        });
        const page = missing[0];
        if (!page) break;
        const key = `${scope}|${pageKey(page)}`;
        const live = latestSnapshot.current;
        snapshots.current.set(key, key === latest.current ? live : { ...live, page, revealed: live.revealed ? EMPTY_REVEALED : undefined, highlightLabel: undefined });
        setPool((previous) => {
          const limit = PAGE_CACHE_LIMIT;
          const next = [...previous.filter((k) => k.startsWith(scope + '|') && k !== key), key];
          while (next.length > limit) {
            const victim = next.findIndex((k) => k !== latest.current && k !== activeRef.current && !targets.some((p) => `${scope}|${pageKey(p)}` === k));
            if (victim < 0) break;
            const removed = next.splice(victim, 1)[0];
            snapshots.current.delete(removed); callbacks.current.delete(removed); readyPages.current.delete(removed);
          }
          return next;
        });
        while (alive && background.current && latest.current === selecting && !readyPages.current.has(key)) await new Promise((resolve) => setTimeout(resolve, 20));
        if (!alive) return;
        // Mount future pages between frames, without ever exposing them over the current page.
        await new Promise((resolve) => setTimeout(resolve, 16));
      } } finally { running = false; }
    };
    const wake = () => { void run(); };
    schedule.current = wake;
    wake();
    return () => { alive = false; if (schedule.current === wake) schedule.current = null; };
  }, [scope, pageIds, pages, props.deck.config, reference, props.folder, props.mode]);
  useEffect(() => { schedule.current?.(); }, [identity, backgroundActive]);

  useLayoutEffect(() => {
    const root = layers.current.get(identity)?.querySelector<HTMLElement>('.sv');
    if (root?.dataset.slideReady === 'true' && pageMediaReady(root)) setActive(identity);
  }, [identity, layouts, resources]);

  useLayoutEffect(() => {
    if (viewActive && current && !transitioning) layers.current.get(current)?.dispatchEvent(new Event('raster-scale'));
  }, [viewActive, current, transitioning, displayZoom]);

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
          if (ready && latest.current === key) {
            // A cold page can become ready while background mounting is paused.
            // Keep it in the pool too, so readiness never outlives its page DOM.
            setPool((previous) => {
              if (previous.includes(key)) return previous;
              const next = [...previous.filter((k) => k.startsWith(scope + '|')), key];
              while (next.length > PAGE_CACHE_LIMIT) {
                const victim = next.findIndex((k) => k !== latest.current && k !== activeRef.current);
                if (victim < 0) break;
                const removed = next.splice(victim, 1)[0];
                snapshots.current.delete(removed); callbacks.current.delete(removed); readyPages.current.delete(removed);
              }
              return next;
            });
            setActive(key);
          }
        };
        callbacks.current.set(key, notify);
      }
      const visible = viewActive && key === current && (!transitioning || retainOutgoing);
      const animated = frame.page.slide?.blocks.some((block) => block.type === 'video' || /\.gif$/i.test(block.src ?? ''));
      return <div key={key} className="ready-slide-layer" data-stage-visible={visible || undefined} aria-hidden={!visible || undefined}
        ref={(node) => { if (node) { const inert = !viewActive || !visible || transitioning || warming; if (node.inert !== inert) node.inert = inert; layers.current.set(key, node); } else layers.current.delete(key); }}
        style={{ visibility: visible ? 'visible' : 'hidden', opacity: visible ? 1 : 0, pointerEvents: !visible || transitioning || warming ? 'none' : undefined,
          ...(displayZoom == null ? {} : { width: `${PAGE_SIZE[frame.deck.config.aspect].w}mm`, height: `${PAGE_SIZE[frame.deck.config.aspect].h}mm`, zoom: visible ? displayZoom : 1 }) }}>
        <SlideView {...frame} resourceSnapshot={pageMediaSnapshot(frame.page, frame.folder, props.resourceSnapshot ?? resources)} layoutSnapshot={pageLayoutSnapshot(frame.page, frame.deck.config.aspect, props.layoutSnapshot ?? layouts)}
          mediaActive={animated ? viewActive && visible && !warming : undefined} onReady={notify} />
      </div>;
    })}
  </div>;
}
