// 中央编辑画布
// - 缩放语义：zoom=1 即「适页」——页面宽与高都完整落在画布内（min(宽fit, 高fit)），
//   显示的百分比 = zoom×100；窗口尺寸变化时 ResizeObserver 重算 fit，100% 恒等于适页
// - 外层 .page-sizer 用缩放后的显式尺寸占位，内部 transform origin top-left：
//   放大后滚动范围正确
// - 抖动防护：scrollbar-gutter:stable + fit 变化阈值
// - 滚轮：Ctrl 缩放（不再用滚轮翻页——易误触）

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SlideView } from './SlideView';
import { PAGE_SIZE } from '../model/types';
import { onOverlay } from './overlays';

const PAD_W = 72;  // 左右滚动条/边距预留
const PAD_H = 100; // 上下边距 + zoom 条预留

export function EditorCanvas() {
  const deck = useStore((s) => s.deck);
  const computed = useStore((s) => s.computed);
  const current = useStore((s) => s.current);
  const folder = useStore((s) => s.folder);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const gotoPage = useStore((s) => s.gotoPage);
  const setFlash = useStore((s) => s.setFlash);
  const flash = useStore((s) => s.flash);

  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);

  const size = PAGE_SIZE[deck.config.aspect];
  const pxW = (size.w * 96) / 25.4;
  const pxH = (size.h * 96) / 25.4;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      const w = box.clientWidth - PAD_W;
      const h = box.clientHeight - PAD_H;
      if (w > 100 && h > 100) {
        setFit((prev) => {
          const next = Math.min(w / pxW, h / pxH);
          return Math.abs(next - prev) > 0.005 ? next : prev;
        });
      }
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [pxW, pxH]);

  // 跳转高亮 1.2s 后清除
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash, setFlash]);

  const page = computed.pages[current];
  const scale = fit * zoom;

  const onRef = useCallback((label: string) => {
    useStore.getState().jumpToRef(label);
  }, []);

  // Ctrl+滚轮缩放：React 18 的 onWheel 是 passive 监听（preventDefault 静默无效且控制台报错），
  // 改原生非 passive 绑定；普通滚轮只滚动画布，不翻页
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const s = useStore.getState();
      s.setZoom(s.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      className="editor-canvas"
      ref={boxRef}
      onMouseDown={(e) => {
        // 点画布空白处退出文本编辑。注意：portal 浮层的事件沿 React 树冒泡到此，
        // 但 DOM 上不在画布内——用 DOM 包含关系 + 浮层清单双重判定
        const t = e.target as HTMLElement;
        if (t.closest('.page-wrap, .zoom-bar')) return;
        if (!e.currentTarget.contains(t) || onOverlay(t)) return;
        useStore.getState().setEditing(null);
      }}
    >
      <div className="zoom-bar">
        <button onClick={() => setZoom(zoom / 1.15)}>−</button>
        <span className="zoom-val">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(zoom * 1.15)}>＋</button>
        <button title="重置（适页 = 100%）" onClick={() => setZoom(1)}>⟳</button>
      </div>
      {/* PowerPoint 状态栏式：右下角放映入口（从当前页开始，F5 同效） */}
      <button
        className="present-fab"
        title="从当前页开始放映（F5）"
        onClick={() => { void useStore.getState().startPresent(); }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.8 1.6v8.8L10.4 6z" fill="currentColor" /></svg>
        放映
      </button>
      {page && fit > 0 && (
        <div className="page-sizer" style={{ width: pxW * scale, height: pxH * scale }}>
          <div
            className="page-wrap"
            style={{ width: pxW, height: pxH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            <SlideView
              page={page}
              deck={deck}
              computed={computed}
              folder={folder ?? ''}
              mode="edit"
              onRef={onRef}
              onSlideJump={(i) => gotoPage(i, true)}
              highlightLabel={flash?.page === current ? flash.label : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
