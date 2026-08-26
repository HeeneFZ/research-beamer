// 图片 / PDF / EPS / SVG / 视频渲染
// PDF/EPS 矢量按 600DPI 渲染进 canvas；图片 object-fit contain 等比（width 为页宽比例）
// 编辑态支持边缘拖拽调宽（EdgeResizeHandles）：指针靠近图左/右缘出现拖拽条

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Block, Palette } from '../model/types';
import { Computed } from '../model/numbering';
import { InlineText } from './InlineText';
import { cancelCanvasRender, ensurePdfAspect, fileUrl, pdfAspectSync, renderPdfToCanvas } from './pdfRaster';
import { absMediaPath } from './paths';

/** PDF 首页渲染精度：600 DPI */
const PDF_DPI_SCALE = 600 / 96;

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
export function PdfCanvas({ abs }: { abs: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState<number | undefined>(pdfAspectSync(abs));

  useEffect(() => {
    let alive = true;
    setAspect(pdfAspectSync(abs));
    ensurePdfAspect(abs)
      .then((a) => { if (alive) setAspect(a); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [abs]);

  // useLayoutEffect：重挂（页切换回来）时 aspect 已在 aspectCache 同步命中，
  // 位图缓存同步贴回赶在首帧绘制前——挂载帧即出图，零白屏间隙
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const box = canvas?.parentElement;
    if (!canvas || !box || !aspect) return;
    const draw = () => {
      const w = box.clientWidth;
      if (w > 0) renderPdfToCanvas(abs, canvas, w, PDF_DPI_SCALE);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => {
      ro.disconnect();
      cancelCanvasRender(canvas);
    };
  }, [abs, aspect]);

  return (
    // maxWidth 由宽高比反推：限制高度不超过 --img-max-h（与位图 max-height 对等，随页面密度），
    // 防止竖长矢量图撑出版心被 overflow:hidden 裁切
    <div className="pdf-fig" style={aspect ? { aspectRatio: String(aspect), maxWidth: `calc(var(--img-max-h, 42cqh) * ${aspect})` } : undefined}>
      <canvas ref={canvasRef} />
    </div>
  );
}

/** EPS：主进程 Ghostscript 转矢量 PDF 后渲染；媒体弹窗预览复用 */
export function EpsFigure({ abs }: { abs: string }) {
  const [pdf, setPdf] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    setPdf(null);
    setErr(false);
    window.api.ensureEpsPdf({ absPath: abs }).then((r) => {
      if (!alive) return;
      if (r.pdf) setPdf(r.pdf);
      else setErr(true);
    });
    return () => { alive = false; };
  }, [abs]);
  if (pdf) return <PdfCanvas abs={pdf} />;
  if (err) return <div className="fig-note">EPS 需要 Ghostscript（C:\Program Files\gs）</div>;
  // 转换期占位：data-eps-pending 让溢出扫描等待（否则扫描提前收工，图后撑出版心）
  return <div className="fig-note eps-pending" data-eps-pending>EPS 转换中…</div>;
}

export function FigureView({
  block, folder, computed, lang, palette, onRef, onZoom, onWidthChange,
}: {
  block: Block;
  folder: string;
  computed: Computed;
  lang: 'zh' | 'en';
  palette: Palette;
  onRef?: (label: string) => void;
  onZoom?: (abs: string, ext: string, caption?: string) => void;
  onWidthChange?: (w: number) => void;
}) {
  const figRef = useRef<HTMLElement | null>(null);
  // 位图固有宽高比（加载后测得）：宽/高双约束取交集的另一半（对齐 PdfCanvas 语义）——
  // 限高钳住时按 aspect 反推 maxWidth 收盒子，宽度滑块在饱和前始终有效
  const [natAspect, setNatAspect] = useState<number | undefined>(undefined);
  if (!block.src) return null;
  const abs = absPath(folder, block.src);
  const lower = block.src.toLowerCase();
  // 显式 width 优先（用户设定/拖拽调宽）；未设置时由排版规格自动给宽
  const w = block.width != null ? `${Math.round(block.width * 100)}%` : 'var(--img-auto-w, 62%)';
  const ext = (block.src.split('.').pop() || '').toLowerCase();

  let inner: JSX.Element;
  if (lower.endsWith('.pdf')) inner = <PdfCanvas abs={abs} />;
  else if (lower.endsWith('.eps')) inner = <EpsFigure abs={abs} />;
  else {
    inner = (
      <img
        src={fileUrl(abs)}
        alt={block.caption || ''}
        draggable={false}
        onLoad={(e) => {
          const im = e.currentTarget;
          if (im.naturalHeight > 0) setNatAspect(im.naturalWidth / im.naturalHeight);
        }}
      />
    );
  }

  const num = computed.figureNum.get(block.id);

  return (
    <figure
      className="fig"
      style={{ width: w, ...(natAspect ? { maxWidth: `calc(var(--img-max-h, 42cqh) * ${natAspect})` } : {}) }}
      ref={(el) => { figRef.current = el; }}
    >
      {inner}
      {onZoom && (
        <button
          className="fig-zoom-btn"
          title="放大查看"
          onClick={(e) => { e.stopPropagation(); onZoom(abs, ext, block.caption); }}
        >⤢</button>
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
export function VideoView({ block, folder, onWidthChange }: { block: Block; folder: string; onWidthChange?: (w: number) => void }) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const figRef = useRef<HTMLElement | null>(null);
  // 与位图同款交集语义：限高钳住时按固有宽高比收盒子（否则黑底元素撑满栏宽，两侧露黑边）
  const [vidAspect, setVidAspect] = useState<number | undefined>(undefined);
  if (!block.src) return null;
  const abs = absPath(folder, block.src);
  const w = block.width != null ? `${Math.round(block.width * 100)}%` : 'var(--img-auto-w, 62%)';
  return (
    <figure
      className="fig"
      style={{ width: w, ...(vidAspect ? { maxWidth: `calc(var(--img-max-h, 42cqh) * ${vidAspect})` } : {}) }}
      ref={(el) => { figRef.current = el; }}
    >
      <video
        ref={vidRef}
        src={fileUrl(abs)}
        controls={!block.autoplay}
        preload="auto"
        muted
        onLoadedMetadata={() => {
          const v = vidRef.current;
          if (v && v.videoHeight > 0) setVidAspect(v.videoWidth / v.videoHeight);
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
      <canvas ref={frameRef} className="vid-firstframe" />
      {onWidthChange && <EdgeResizeHandles hostRef={figRef} block={block} onWidthChange={onWidthChange} />}
    </figure>
  );
}
