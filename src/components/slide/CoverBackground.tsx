import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BackgroundImage, DeckConfig, Pos } from '../../model/types';
import { PAGE_SIZE } from '../../model/types';
import { clampBackgroundPos, defaultBackgroundPos } from '../../model/background';
import { mediaAspect } from '../../model/mediaGeometry';
import { flushProjectDrafts, PROJECT_DRAFT_FLUSH, useStore } from '../../state/store';
import { absMediaPath } from '../paths';
import { fileUrl } from '../pdfRaster';
import { IcoClose, IcoImage, IcoMove, IcoReset, IcoTrash } from '../icons';
import type { SlideMode } from './types';

function NumberField({ label, title, value, min, max, onCommit }: {
  label: string; title: string; value: number; min?: number; max?: number; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(Math.round(value * 10) / 10));
  const focused = useRef(false), cancelled = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(Math.round(value * 10) / 10)); }, [value]);
  return <label className="background-number" title={title}>{label}<input aria-label={title} type="number" min={min} max={max} step="0.1" value={text}
    onFocus={() => { focused.current = true; cancelled.current = false; }} onChange={(e) => setText(e.target.value)}
    onBlur={() => {
      focused.current = false;
      const number = parseFloat(text);
      if (!cancelled.current && Number.isFinite(number)) {
        const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number));
        setText(String(next)); onCommit(next);
      } else setText(String(Math.round(value * 10) / 10));
    }} onKeyDown={(e) => {
      if (e.key === 'F5' || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') return;
      e.stopPropagation();
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
    }} /></label>;
}

/** Page-local action and contextual tools; previews never update the deck per frame. */
export function CoverBackground({ config, folder, mode, placement, slideId, active, editable }: {
  config: DeckConfig; folder: string; mode: SlideMode; placement: 'title' | 'end'; slideId?: string; active: boolean; editable: boolean;
}) {
  const key = placement === 'title' ? 'titleBackground' : 'endBackground';
  const saved = config[key];
  const [draft, setDraft] = useState<BackgroundImage | undefined>();
  const draftRef = useRef<BackgroundImage | undefined>();
  const [loaded, setLoaded] = useState<{ src: string; aspect: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null), buttonRef = useRef<HTMLButtonElement>(null), toolsRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>();
  const [open, setOpen] = useState(false), [moving, setMoving] = useState(false);
  const [toolsPos, setToolsPos] = useState<{ left: number; top: number } | null>(null);
  const stopRef = useRef<((commit: boolean) => void) | null>(null);
  const pickRequest = useRef(0);
  const owner = useRef(useStore.getState().mediaRevision).current;
  const image = draft ?? saved;
  const abs = image ? absMediaPath(folder, image.src) : '';
  const size = PAGE_SIZE[config.aspect];
  const aspect = (loaded?.src === abs ? loaded.aspect : mediaAspect(abs)) ?? size.w / size.h;
  const pos = image?.pos ?? defaultBackgroundPos(size.w / size.h, aspect);
  const opacity = image?.opacity ?? 1;
  const showTools = mode === 'edit' && active && (open || editable);
  const activate = () => {
    let state = useStore.getState();
    if (!slideId || state.mediaRevision !== owner || state.projectExiting || state.presenting
      || state.computed.pages[state.current]?.slide?.id !== slideId) return false;
    if (state.editing?.slideId !== slideId || state.editing?.field !== 'background') {
      const focused = document.activeElement;
      flushProjectDrafts();
      state = useStore.getState();
      if (state.mediaRevision !== owner || state.projectExiting || state.presenting
        || state.computed.pages[state.current]?.slide?.id !== slideId) return false;
      state.setEditing({ slideId, field: 'background' });
      if (focused instanceof HTMLElement && focused.isConnected && toolsRef.current?.contains(focused)) focused.focus({ preventScroll: true });
    }
    setOpen(true); return true;
  };
  const valid = () => {
    const state = useStore.getState();
    return state.mediaRevision === owner && !state.projectExiting && !state.presenting
      && state.editing?.slideId === slideId && state.editing?.field === 'background';
  };
  const preview = (value: BackgroundImage) => { pickRequest.current++; draftRef.current = value; setDraft(value); };
  const write = (value: BackgroundImage | undefined) => {
    pickRequest.current++;
    if (valid()) useStore.getState().setConfig({ [key]: value });
    draftRef.current = undefined; setDraft(undefined);
  };
  const commit = () => { if (draftRef.current) write(draftRef.current); };
  const done = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && toolsRef.current?.contains(focused)) focused.blur();
    stopRef.current?.(true); commit(); setOpen(false); setMoving(false);
    if (valid()) useStore.getState().setEditing(null);
  };
  const latest = useRef({ commit, done, editable });
  latest.current = { commit, done, editable };
  useEffect(() => { pickRequest.current++; draftRef.current = undefined; setDraft(undefined); }, [saved]);
  useEffect(() => {
    if (!active || !editable) {
      pickRequest.current++; stopRef.current?.(false); draftRef.current = undefined;
      setDraft(undefined); setOpen(false); setMoving(false);
    }
  }, [active, editable]);
  useEffect(() => {
    if (!showTools) return;
    const flush = () => { stopRef.current?.(true); latest.current.commit(); };
    window.addEventListener(PROJECT_DRAFT_FLUSH, flush, true);
    return () => { pickRequest.current++; window.removeEventListener(PROJECT_DRAFT_FLUSH, flush, true); stopRef.current?.(false); };
  }, [showTools]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const keepOpen = () => { clearTimeout(hideTimer.current); setOpen(true); };
  const hideSoon = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!latest.current.editable && !toolsRef.current?.contains(document.activeElement)) setOpen(false);
    }, 260);
  };
  useEffect(() => {
    if (!showTools) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (toolsRef.current?.contains(target) || buttonRef.current?.contains(target) || target.closest('.background-edit-surface')) return;
      latest.current.done();
    };
    const escape = (event: KeyboardEvent) => { if (!event.isComposing && event.key === 'Escape') latest.current.done(); };
    window.addEventListener('mousedown', outside); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('keydown', escape); };
  }, [showTools]);
  useLayoutEffect(() => {
    if (!showTools) { setToolsPos(null); return; }
    const bar = toolsRef.current!, page = buttonRef.current?.closest('.sv');
    if (!page) return;
    const canvas = page.closest('.editor-canvas');
    const place = () => {
      const rect = page.getBoundingClientRect(), viewport = canvas?.getBoundingClientRect();
      const bottom = Math.min(rect.bottom, viewport?.bottom ?? rect.bottom);
      const top = Math.max(rect.top, viewport?.top ?? rect.top);
      const left = Math.max(8, Math.min(rect.right - bar.offsetWidth, window.innerWidth - bar.offsetWidth - 8));
      const y = bottom + bar.offsetHeight + 6 <= window.innerHeight - 8 ? bottom + 6 : Math.max(8, top - bar.offsetHeight - 6);
      setToolsPos((old) => old && Math.abs(old.left - left) < .5 && Math.abs(old.top - y) < .5 ? old : { left, top: y });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(bar);
    let frame = 0, previous = 0;
    const follow = (time: number) => { if (time - previous > 100) { place(); previous = time; } frame = requestAnimationFrame(follow); };
    frame = requestAnimationFrame(follow);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [showTools]);

  const pick = async () => {
    if (!activate()) return;
    if (!folder) { useStore.getState().setFlashMsg('请先保存工程（需要 media/ 目录）'); return; }
    const request = ++pickRequest.current;
    const selected = await window.api.pickMedia({ background: true });
    if (!selected || !valid() || request !== pickRequest.current) return;
    if (!/\.(png|jpe?g|webp|svg|gif|bmp|avif)$/i.test(selected.path)) {
      useStore.getState().setFlashMsg('请选择 PNG、JPG、WebP、SVG、GIF、BMP 或 AVIF 图片'); return;
    }
    const imported = await window.api.importMedia({ srcPath: selected.path, folder });
    if (!valid() || request !== pickRequest.current) return;
    if (imported?.fileName) { write({ src: 'media/' + imported.fileName, opacity }); setMoving(true); }
    else useStore.getState().setFlashMsg('背景图片导入失败');
  };
  const startDrag = (event: React.MouseEvent, side: -1 | 0 | 1) => {
    if (event.button !== 0 || !image || !valid()) return;
    event.preventDefault(); event.stopPropagation(); stopRef.current?.(false);
    const page = imageRef.current?.closest('.sv')?.getBoundingClientRect();
    if (!page?.width || !page.height) return;
    const initial = pos, x = event.clientX, y = event.clientY;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = side ? 'ew-resize' : 'grabbing';
    const move = (next: MouseEvent) => {
      const dx = (next.clientX - x) * 100 / page.width, dy = (next.clientY - y) * 100 / page.height;
      const width = clampBackgroundPos({ ...initial, w: initial.w + side * dx }).w;
      const position: Pos = side ? { ...initial, w: width, x: side < 0 ? initial.x + initial.w - width : initial.x }
        : { ...initial, x: initial.x + dx, y: initial.y + dy };
      preview({ ...image, pos: clampBackgroundPos(position) });
    };
    const finish = (save: boolean) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape, true);
      document.body.style.cursor = previousCursor; stopRef.current = null;
      if (save) commit();
      else { draftRef.current = undefined; setDraft(undefined); }
    };
    const up = () => finish(true), cancel = () => finish(false);
    const escape = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); cancel(); } };
    stopRef.current = finish;
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    window.addEventListener('blur', cancel); window.addEventListener('keydown', escape, true);
  };
  const positionStyle = { left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%` };
  return <>
    {image && <img ref={imageRef} className="cover-background" data-background-src={image.src} alt="" draggable={false}
      src={fileUrl(abs)} style={{ ...positionStyle, opacity }}
      onLoad={(e) => { const img = e.currentTarget; if (img.naturalWidth && img.naturalHeight) setLoaded({ src: abs, aspect: img.naturalWidth / img.naturalHeight }); }} />}
    {mode === 'edit' && active && <button ref={buttonRef} className="add-first-btn background-trigger"
      aria-expanded={showTools} title="选择背景图片并快捷调整" onMouseEnter={keepOpen} onMouseLeave={hideSoon} onFocus={keepOpen}
      onClick={(event) => { event.stopPropagation(); if (editable) done(); else if (activate()) { if (image) setMoving(true); else void pick(); } }}>设置背景</button>}
    {showTools && <>
      {image && moving && <div className="background-edit-surface" onMouseDown={(e) => startDrag(e, 0)}>
        <div className="background-bounds" style={{ ...positionStyle, aspectRatio: String(aspect) }} />
        <div className="edge-rz edge-rz-l" onMouseDown={(e) => startDrag(e, -1)} />
        <div className="edge-rz edge-rz-r" onMouseDown={(e) => startDrag(e, 1)} />
      </div>}
      {createPortal(<div ref={toolsRef} className="btools-float background-tools" role="toolbar" aria-label={placement === 'title' ? '封面背景工具' : '结尾背景工具'}
        style={toolsPos ?? { left: -9999, top: -9999, visibility: 'hidden' }}
        onMouseEnter={keepOpen} onMouseLeave={hideSoon}
        onFocusCapture={activate}
        onMouseDown={(e) => { e.stopPropagation(); activate(); }} onClick={(e) => e.stopPropagation()}>
        <button className="background-pick" title={image ? '更换背景图片' : '选择背景图片'} onClick={() => { void pick(); }}><IcoImage />{image ? '更换' : '选图'}</button>
        {image && <>
          <button className={moving ? 'on' : ''} aria-pressed={moving} title="拖动背景、左右手柄缩放" onClick={() => setMoving(!moving)}><IcoMove /></button>
          {(['x', 'y', 'w'] as const).map((field) => <NumberField key={field} label={field === 'x' ? 'X' : field === 'y' ? 'Y' : '宽'}
            title={field === 'x' ? '水平位置 %' : field === 'y' ? '垂直位置 %' : '宽度 %'} value={pos[field]} min={field === 'w' ? 1 : undefined}
            onCommit={(value) => write({ ...image, pos: clampBackgroundPos({ ...pos, [field]: value }) })} />)}
          <NumberField label="不透明度" title="背景不透明度 %" value={opacity * 100} min={0} max={100} onCommit={(value) => write({ ...image, opacity: value / 100 })} />
          <input className="background-opacity" aria-label="背景不透明度" type="range" min="0" max="100" value={opacity * 100}
            onChange={(e) => preview({ ...image, opacity: Number(e.target.value) / 100 })} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
          <button title="铺满并居中" onClick={() => write({ ...image, pos: undefined })}><IcoReset /></button>
          <button className="danger" title="移除背景" onClick={() => { setMoving(false); write(undefined); }}><IcoTrash /></button>
        </>}
        <button title="完成背景设置" onClick={done}><IcoClose /></button>
      </div>, document.body)}
    </>}
  </>;
}
