// 图片 / PDF / EPS / SVG / 视频渲染
// PDF/EPS 矢量最高 1200DPI，单图与缓存均限制内存；CSS 几何不受位图精度影响。
// 编辑态支持边缘拖拽调宽（EdgeResizeHandles）：指针靠近图左/右缘出现拖拽条

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Block, Palette } from '../model/types';
import { Computed } from '../model/numbering';
import { InlineText } from './InlineText';
import { cancelCanvasRender, ensurePdfAspect, fileUrl, pdfAspectSync, PDF_DPI_SCALE, PDF_PREVIEW_WIDTH } from './pdfRaster';
import { epsTarget, mediaAspect, mediaFailure, mediaRevision, rememberEpsTarget, rememberMediaAspect, rememberMediaFailure } from '../model/mediaGeometry';
import { absMediaPath } from './paths';
import { useStore } from '../state/store';
import { drawPreparedRaster } from './resourceRaster';
import type { MediaPreparation } from '../model/mediaResources';
import { IcoLens } from './icons';
import type { SlideMode } from './slide/types';

const absPath = absMediaPath;

/** 拖拽结束时吞掉紧随的 click（否则会误触图块属性弹窗）；300ms 兜底自清 */
function swallowNextClick(fig: HTMLElement | null): void {
  if (!fig) return;
  const h = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    fig.removeEventListener('click', h, true);
  };
  fig.addEventListener('click', h, true);
  window.setTimeout(() => fig.removeEventListener('click', h, true), 300);
}

/** 图/视频/表格边缘拖拽调宽手柄：左右缘 10px 热区，水平拖动改显示宽度（0.15–1）。
 *  屏幕 px 与版心布局 px 之间隔了页面 transform 缩放——用宿主的 rect/offset 比换算；
 *  宿主居中（margin auto），拖右缘宽 = w0 + 2dx/cw、拖左缘 w0 − 2dx/cw（边缘跟随指针）。 */
export function EdgeResizeHandles({ hostRef, block, onWidthChange }: {
  hostRef: React.RefObject<HTMLElement | null>;
  block: Block;
  onWidthChange: (w: number) => void;
}) {
  const dragRef = useRef<{ x: number; w0: number; cw: number; scale: number; side: 1 | -1; moved: boolean } | null>(null);
  const onDown = (side: 1 | -1) => (e: React.MouseEvent) => {
    const host = hostRef.current;
    if (!host || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.ord-badge, .li-ord, button, input')) return;
    e.preventDefault();
    e.stopPropagation();
    const cw = host.parentElement?.clientWidth || host.clientWidth || 1;
    const scale = host.offsetWidth > 0 ? host.getBoundingClientRect().width / host.offsetWidth : 1;
    const w0 = block.width ?? (cw > 0 ? host.clientWidth / cw : 0.6);
    dragRef.current = { x: e.clientX, w0, cw, scale, side, moved: false };
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'ew-resize';
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.x) / (d.scale || 1);
      if (Math.abs(ev.clientX - d.x) > 3) d.moved = true;
      const w = Math.min(1, Math.max(0.15, Math.round((d.w0 + d.side * (2 * dx) / d.cw) * 100) / 100));
      onWidthChange(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      if (dragRef.current?.moved) swallowNextClick(hostRef.current);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return (
    <>
      <div className="edge-rz edge-rz-l" onMouseDown={onDown(-1)} />
      <div className="edge-rz edge-rz-r" onMouseDown={onDown(1)} />
    </>
  );
}

/** PDF 首页矢量渲染（含 eps 转出的 pdf）；媒体弹窗预览复用 */
export function PdfCanvas({ abs, thumbnail = false, preparation: snapshot }: { abs: string; thumbnail?: boolean; preparation?: MediaPreparation }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preparation = useStore((state) => snapshot ?? state.mediaPreparation);
  const resource = preparation.resources[abs];
  const [geometry, setGeometry] = useState<{ abs: string; aspect: number } | null>(null);
  const aspect = resource?.aspect ?? (geometry?.abs === abs ? geometry.aspect : pdfAspectSync(abs));
  const [failure, setFailure] = useState<{ abs: string; message: string } | null>(null);
  const error = (failure?.abs === abs ? failure.message : null) ?? preparation.errors[abs] ?? preparation.errors.__prepare__ ?? mediaFailure(abs);
  const boxAspect = aspect ?? (error ? 16 / 9 : undefined);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.height = 0;
      canvas.dataset.mediaPending = 'true';
      delete canvas.dataset.mediaError;
    }
  }, [abs]);

  useEffect(() => {
    let alive = true;
    ensurePdfAspect(abs)
      .then((aspect) => { if (alive) setGeometry({ abs, aspect }); })
      .catch((e) => { if (alive) setFailure({ abs, message: String(e) }); });
    return () => { alive = false; };
  }, [abs]);

  // useLayoutEffect：重挂（页切换回来）时 aspect 已在 aspectCache 同步命中，
  // 位图缓存同步贴回赶在首帧绘制前——挂载帧即出图，零白屏间隙
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const box = canvas?.parentElement;
    if (!canvas || !box || !aspect || error || !resource) return;
    let cancelled = false;
    let drawing = 0;
    const draw = () => {
      const w = box.clientWidth;
      if (w > 0) {
        const precision = thumbnail
          ? Math.max(PDF_PREVIEW_WIDTH / w, (box.getBoundingClientRect().width / w) * (window.devicePixelRatio || 1))
          : PDF_DPI_SCALE;
        const token = ++drawing;
        canvas.dataset.mediaPending = 'true';
        void drawPreparedRaster(resource, canvas, w * precision, () => !cancelled && token === drawing)
          .catch((error) => { if (!cancelled) { canvas.dataset.mediaError = String(error); delete canvas.dataset.mediaPending; canvas.dispatchEvent(new Event('error')); } });
      }
    };
    const onError = () => setFailure({ abs, message: canvas.dataset.mediaError || 'PDF 绘制失败' });
    canvas.addEventListener('error', onError);
    draw();
    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(draw, thumbnail ? 0 : 80);
    });
    ro.observe(box);
    return () => {
      cancelled = true;
      ro.disconnect();
      clearTimeout(timer);
      canvas.removeEventListener('error', onError);
      cancelCanvasRender(canvas);
    };
  }, [abs, aspect, thumbnail, error, resource]);

  return (
    // maxWidth 由宽高比反推：限制高度不超过 --img-max-h（与位图 max-height 对等，随页面密度），
    // 防止竖长矢量图撑出版心被 overflow:hidden 裁切
    <div className="pdf-fig" data-pdf-source={abs} data-layout-pending={!boxAspect ? '' : undefined} data-media-error={error || undefined} style={boxAspect ? { aspectRatio: String(boxAspect), maxWidth: `calc(var(--img-max-h, 42cqh) * ${boxAspect})` } : undefined}>
      <canvas ref={canvasRef} width={0} height={0} />
      {error && <div className="fig-note">PDF 加载失败：{error}</div>}
    </div>
  );
}

/** EPS：主进程 Ghostscript 转矢量 PDF 后渲染；媒体弹窗预览复用 */
export function EpsFigure({ abs, thumbnail = false, preparation }: { abs: string; thumbnail?: boolean; preparation?: MediaPreparation }) {
  const [result, setResult] = useState<{ abs: string; pdf?: string; error?: boolean } | null>(null);
  const target = epsTarget(abs);
  const current = target !== undefined ? { pdf: target, error: target === null } : result?.abs === abs ? result : null;
  useEffect(() => {
    if (epsTarget(abs) !== undefined) return;
    let alive = true;
    const version = mediaRevision();
    window.api.ensureEpsPdf({ absPath: abs }).then((r) => {
      if (!alive) return;
      rememberEpsTarget(abs, r.pdf ?? null, version);
      setResult({ abs, pdf: r.pdf, error: !r.pdf });
    }).catch(() => {
      if (alive) { rememberEpsTarget(abs, null, version); setResult({ abs, error: true }); }
    });
    return () => { alive = false; };
  }, [abs]);
  if (current?.pdf) return <PdfCanvas abs={current.pdf} thumbnail={thumbnail} preparation={preparation} />;
  if (current?.error) return <div className="fig-note" data-media-error="EPS 转换失败">EPS 需要 Ghostscript（C:\Program Files\gs）</div>;
  // 转换期占位：data-eps-pending 让溢出扫描等待（否则扫描提前收工，图后撑出版心）
  return <div className="fig-note eps-pending" data-eps-pending>EPS 转换中…</div>;
}

/** GIF 静帧（缩略图用）：离屏 Image 解码、drawImage 取首帧入 canvas——图片不进 DOM
 *  即不起 Chromium 动画循环（对动画图 drawImage 恒画默认帧=首帧）。胶片缩略图渲染
 *  全部页，几十张 GIF 同时持续播放/解码会拖垮编辑帧率（用户实测卡顿报障）；
 *  画布与放映仍用 <img> 原生播放；排版等待固有宽高比，而不是位图精度。 */
export function GifStillFrame({ abs, onAspect, onError }: { abs: string; onAspect: (a: number) => void; onError: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (!alive) return;
      if (!(im.naturalWidth > 0 && im.naturalHeight > 0)) { onError(); return; }
      onAspect(im.naturalWidth / im.naturalHeight);
      const c = ref.current;
      if (!c) return;
      const scale = Math.min(1, 512 / im.naturalWidth, 512 / im.naturalHeight);
      c.width = Math.max(1, Math.round(im.naturalWidth * scale));
      c.height = Math.max(1, Math.round(im.naturalHeight * scale));
      c.getContext('2d')?.drawImage(im, 0, 0, c.width, c.height);
      im.onload = im.onerror = null;
      im.src = ''; // The thumbnail owns the first frame; release the large animation source.
    };
    im.src = fileUrl(abs);
    im.onerror = () => {
      if (!alive) return;
      if (ref.current) ref.current.dataset.mediaError = 'GIF 加载失败';
      onError();
    };
    return () => { alive = false; im.onload = null; im.onerror = null; };
  }, [abs, onAspect, onError]);
  return <canvas ref={ref} className="gif-still" width={0} height={0} />;
}
export function FigureView({
  block, folder, computed, lang, palette, onRef, onZoom, onWidthChange, still, preparation,
}: {
  block: Block;
  folder: string;
  computed: Computed;
  lang: 'zh' | 'en';
  palette: Palette;
  onRef?: (label: string) => void;
  onZoom?: (abs: string, ext: string, caption?: string) => void;
  onWidthChange?: (w: number) => void;
  /** 静帧渲染（缩略图）：GIF 不播放（首帧 canvas），防胶片全页动画拖垮编辑帧率 */
  still?: boolean;
  preparation?: MediaPreparation;
}) {
  const figRef = useRef<HTMLElement | null>(null);
  // 位图固有宽高比（加载后测得）：宽/高双约束取交集的另一半（对齐 PdfCanvas 语义）——
  // 限高钳住时按 aspect 反推 maxWidth 收盒子，宽度滑块在饱和前始终有效
  const abs = block.src ? absPath(folder, block.src) : '';
  const version = mediaRevision();
  const isVector = /\.(pdf|eps)$/i.test(block.src ?? '');
  const [geometry, setGeometry] = useState<{ abs: string; aspect: number } | null>(null);
  // PDF/EPS reserve their image box internally. Keep the original caption width;
  // their newly cached ratio must not change the outer figure after finalization.
  const natAspect = isVector ? undefined : geometry?.abs === abs ? geometry.aspect : mediaAspect(abs);
  const [failedAbs, setFailedAbs] = useState<string | null>(null);
  const failed = !isVector && (failedAbs === abs || !!mediaFailure(abs));
  const setNatAspect = useCallback((aspect: number) => {
    rememberMediaAspect(abs, aspect, version);
    setGeometry({ abs, aspect });
  }, [abs, version]);
  const onError = useCallback(() => {
    rememberMediaFailure(abs, '图片加载失败', version);
    setFailedAbs(abs);
  }, [abs, version]);
  if (!block.src) return null;
  const lower = block.src.toLowerCase();
  // 显式 width 优先（用户设定/拖拽调宽）；未设置时由排版规格自动给宽
  const w = block.width != null ? `${Math.round(block.width * 100)}%` : 'var(--img-auto-w, 62%)';
  const ext = (block.src.split('.').pop() || '').toLowerCase();

  let inner: JSX.Element;
  if (failed) inner = <div className="fig-placeholder" data-media-error={mediaFailure(abs)} style={{ aspectRatio: String(natAspect ?? 16 / 9) }}>图片加载失败</div>;
  else if (lower.endsWith('.pdf')) inner = <PdfCanvas abs={abs} thumbnail={still} preparation={preparation} />;
  else if (lower.endsWith('.eps')) inner = <EpsFigure abs={abs} thumbnail={still} preparation={preparation} />;
  else if (still && lower.endsWith('.gif')) {
    inner = <GifStillFrame abs={abs} onAspect={setNatAspect} onError={onError} />;
  }
  else {
    inner = (
      <img
        src={fileUrl(abs)}
        alt={block.caption || ''}
        draggable={false}
        style={natAspect ? { aspectRatio: String(natAspect) } : undefined}
        onError={onError}
        onLoad={(e) => {
          const im = e.currentTarget;
          if (im.naturalWidth > 0 && im.naturalHeight > 0) setNatAspect(im.naturalWidth / im.naturalHeight);
          else onError();
        }}
      />
    );
  }

  const num = computed.figureNum.get(block.id);

  return (
    <figure
      className="fig"
      data-layout-pending={!natAspect && !failed && ext !== 'pdf' && ext !== 'eps' ? '' : undefined}
      style={{ width: w, ...(natAspect ? { maxWidth: `calc(var(--img-max-h, 42cqh) * ${natAspect})` } : {}) }}
      ref={(el) => { figRef.current = el; }}
    >
      {inner}
      {onZoom && (
        <button
          className="fig-zoom-btn"
          title="放大查看"
          onClick={(e) => { e.stopPropagation(); onZoom(abs, ext, block.caption); }}
        ><IcoLens /></button>
      )}
      {onWidthChange && <EdgeResizeHandles hostRef={figRef} block={block} onWidthChange={onWidthChange} />}
      {block.caption != null && (
        <figcaption className="fig-caption">
          {num && <span className="cap-num">{lang === 'zh' ? `图 ${num}` : `Fig. ${num}`}</span>}
          <InlineText text={block.caption} computed={computed} lang={lang} palette={palette} onRef={onRef} />
        </figcaption>
      )}
    </figure>
  );
}

/** 视频：编辑/放映用 <video>；导出 PDF 用首帧画布占位（loadeddata 时截取）。
 *  宽度与图片同款：显式 width 优先，未设置走排版规格自动宽（修复曾硬编码 100% 致压缩失效） */
export function VideoView({ block, folder, onWidthChange, mode = 'edit' }: { block: Block; folder: string; onWidthChange?: (w: number) => void; mode?: SlideMode }) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const figRef = useRef<HTMLElement | null>(null);
  // 与位图同款交集语义：限高钳住时按固有宽高比收盒子（否则黑底元素撑满栏宽，两侧露黑边）
  const abs = block.src ? absPath(folder, block.src) : '';
  const version = mediaRevision();
  const [geometry, setGeometry] = useState<{ abs: string; aspect: number } | null>(null);
  const vidAspect = geometry?.abs === abs ? geometry.aspect : mediaAspect(abs);
  const [failedAbs, setFailedAbs] = useState<string | null>(null);
  const failed = failedAbs === abs || !!mediaFailure(abs);
  useEffect(() => {
    const canvas = frameRef.current;
    if (canvas) { canvas.width = canvas.height = 0; delete canvas.dataset.mediaError; }
  }, [block.src, folder]);
  if (!block.src) return null;
  const w = block.width != null ? `${Math.round(block.width * 100)}%` : 'var(--img-auto-w, 62%)';
  return (
    <figure
      className="fig"
      data-layout-pending={!vidAspect && !failed ? '' : undefined}
      style={{ width: w, ...(vidAspect ? { maxWidth: `calc(var(--img-max-h, 42cqh) * ${vidAspect})` } : {}) }}
      ref={(el) => { figRef.current = el; }}
    >
      <video
        ref={vidRef}
        src={fileUrl(abs)}
        controls={!block.autoplay}
        autoPlay={mode === 'present' && !!block.autoplay}
        preload="auto"
        muted
        style={vidAspect ? { aspectRatio: String(vidAspect) } : undefined}
        onError={() => {
          rememberMediaFailure(abs, '视频加载失败', version);
          setFailedAbs(abs);
          if (frameRef.current) frameRef.current.dataset.mediaError = '视频加载失败';
        }}
        onLoadedMetadata={() => {
          const v = vidRef.current;
          if (v && v.videoHeight > 0) {
            const aspect = v.videoWidth / v.videoHeight;
            rememberMediaAspect(abs, aspect, version);
            setGeometry({ abs, aspect });
          } else { rememberMediaFailure(abs, '视频尺寸无效', version); setFailedAbs(abs); }
        }}
        onLoadedData={() => {
          const v = vidRef.current;
          const cv = frameRef.current;
          if (!v || !cv || !v.videoWidth) return;
          cv.width = v.videoWidth;
          cv.height = v.videoHeight;
          cv.getContext('2d')?.drawImage(v, 0, 0);
        }}
      />
      <canvas ref={frameRef} className="vid-firstframe" width={0} height={0} />
      {onWidthChange && <EdgeResizeHandles hostRef={figRef} block={block} onWidthChange={onWidthChange} />}
    </figure>
  );
}
