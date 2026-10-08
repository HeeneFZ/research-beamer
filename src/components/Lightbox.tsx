// 图片放大镜（EditorApp 式）：无限缩放 + 拖拽平移
// - 位图/SVG：<img> transform 缩放（GPU 合成，无重解码）
// - PDF/EPS：pdf.js 按 zoom 重渲染（防抖），矢量放大不糊

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { cancelCanvasRender, fileUrl, renderPdfToCanvas, PDF_DPI_SCALE } from './pdfRaster';
import { IcoZoomIn, IcoZoomOut, IcoReset, IcoClose } from './icons';
import { Computed } from '../model/numbering';
import { Palette } from '../model/types';
import { InlineText } from './InlineText';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 40;

export function Lightbox() {
  const storeLb = useStore((s) => s.lightbox);
  const storeSet = useStore((s) => s.setLightbox);
  const computed = useStore((s) => s.computed);
  const config = useStore((s) => s.deck.config);
  return (
    <LightboxInner
      lb={storeLb}
      onClose={() => storeSet(null)}
      captionCtx={{ computed, lang: config.language, palette: config.palette }}
    />
  );
}

/** 受控形态（放映窗等无 store 实例的场景） */
export function LightboxInner({ lb, onClose, captionCtx }: {
  lb: { abs: string; ext: string; caption?: string } | null;
  onClose: () => void;
  /** 提供时 caption 经 InlineText 渲染（含行内公式/引用/着色）；缺省纯文本 */
  captionCtx?: { computed: Computed; lang: 'zh' | 'en'; palette: Palette };
}) {
  const preparation = useStore((state) => state.mediaPreparation);
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [pdfAbs, setPdfAbs] = useState<string | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // 打开新图时重置
  useEffect(() => {
    setZoom(1);
    setTx(0);
    setTy(0);
    setPdfAbs(null);
    if (lb && lb.ext === 'eps') {
      let alive = true;
      window.api.ensureEpsPdf({ absPath: lb.abs }).then((r) => {
        if (alive) setPdfAbs(r.pdf ?? lb.abs); // 转换失败时退回原路径（渲染报错即显示空）
      });
      return () => { alive = false; };
    }
  }, [lb]);

  const isPdf = lb != null && (lb.ext === 'pdf' || lb.ext === 'eps');
  const pdfTarget = lb && lb.ext === 'eps' ? pdfAbs : lb?.abs ?? null;

  // PDF：按 zoom 防抖重渲染（矢量精度随缩放提升）
  useEffect(() => {
    if (!isPdf || !pdfTarget) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = setTimeout(() => {
      // 显示宽 = wrap CSS 宽 × zoom（transform scale 作用于 wrap）；
      // 位图 = 显示宽 × dpr → 任意缩放都锐利（EditorApp 同款策略）
      const wrapW = canvas.parentElement?.clientWidth || 900;
      const pixels = Math.min(wrapW * PDF_DPI_SCALE, wrapW * zoom * (window.devicePixelRatio || 1));
      renderPdfToCanvas(pdfTarget, canvas, pixels, 1, preparation);
    }, 120);
    return () => { clearTimeout(t); cancelCanvasRender(canvas); };
  }, [isPdf, pdfTarget, zoom, preparation]);


  const onKey = useCallback((e: KeyboardEvent) => {
    if (!lb) return;
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(MAX_ZOOM, z * 1.2));
    else if (e.key === '-') setZoom((z) => Math.max(MIN_ZOOM, z / 1.2));
    else if (e.key === '0') { setZoom(1); setTx(0); setTy(0); }
  }, [lb, close]);

  useEffect(() => {
    if (!lb) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb, onKey]);

  // 滚轮缩放：React 18 的 onWheel 是 passive 监听，preventDefault 静默无效且控制台报错——
  // 必须原生非 passive 绑定；stopPropagation 阻断冒泡到 present-root 的翻页监听（原生层即截断）
  useEffect(() => {
    const el = overlayRef.current;
    if (!lb || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.15 : 0.87))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [lb]);

  if (!lb) return null;

  const reset = () => { setZoom(1); setTx(0); setTy(0); };

  const dragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 仅左键拖拽平移（侧键/右键不触发）
    // 阻止冒泡到 window 级页面平移监听（放大镜内拖拽平移图片 ≠ 平移页面）
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setTx(d.tx + ev.clientX - d.x);
      setTy(d.ty + ev.clientY - d.y);
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;

  return (
    <div className="lb-overlay" ref={overlayRef}>
      <div className="lb-stage" onMouseDown={dragStart} onDoubleClick={reset} title="双击重置">
        {isPdf ? (
          <div className="lb-canvas-wrap" style={{ transform, width: 'min(80vw, 900px)' }}>
            <canvas ref={canvasRef} />
          </div>
        ) : (
          <img
            className="lb-img"
            src={fileUrl(lb.abs)}
            alt={lb.caption || ''}
            draggable={false}
            style={{ transform }}
            onLoad={(e) => {
              // 初始适配：超大图缩到 90% 视口内
              const img = e.currentTarget;
              if (img.naturalWidth > window.innerWidth * 0.9 || img.naturalHeight > window.innerHeight * 0.85) {
                const f = Math.min(
                  (window.innerWidth * 0.9) / img.naturalWidth,
                  (window.innerHeight * 0.85) / img.naturalHeight,
                );
                setZoom(f);
              }
            }}
          />
        )}
      </div>
      <div className="lb-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <span className="lb-name">{lb.abs.split(/[\\/]/).pop()}</span>
        <button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2))}><IcoZoomOut /></button>
        <span className="lb-zoomval">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))}><IcoZoomIn /></button>
        <button title="重置" onClick={reset}><IcoReset /></button>
        <button title="关闭 (Esc)" onClick={close}><IcoClose /></button>
      </div>
      {/* 题注固定在视口底部（不随图片缩放），位于操作提示上方 */}
      {lb.caption && (
        <div className="lb-caption">
          {captionCtx
            ? <InlineText text={lb.caption} computed={captionCtx.computed} lang={captionCtx.lang} palette={captionCtx.palette} />
            : lb.caption}
        </div>
      )}
      <div className="lb-hint">滚轮缩放 · 拖拽平移 · 双击重置 · Esc 关闭</div>
    </div>
  );
}
