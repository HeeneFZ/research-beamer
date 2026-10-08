// 演讲者视图（放映时主窗口的内容区）：当前页 + 下一页预览 + 演讲稿 + 计时器
// 缩放用 page-sizer 模式（外层缩放后尺寸占位，内层 transform origin top-left），
// 修复内容跑出容器的问题；滚轮翻页。

import { useEffect, useMemo, useRef, useState } from 'react';
import { pageOrders, useStore } from '../state/store';
import { SlideView } from './SlideView';
import { PAGE_SIZE } from '../model/types';

/** 容器适页缩放（ResizeObserver 跟踪） */
function useFitScale(pageWmm: number, pageHmm: number, pad = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      const s = Math.min((box.clientWidth - pad) / ((pageWmm * 96) / 25.4), (box.clientHeight - pad) / ((pageHmm * 96) / 25.4));
      if (s > 0) setScale((prev) => (Math.abs(s - prev) > 0.004 ? s : prev));
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [pageWmm, pageHmm, pad]);
  return { ref, scale };
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PresenterView() {
  const deck = useStore((s) => s.deck);
  const computed = useStore((s) => s.computed);
  const current = useStore((s) => s.current);
  const folder = useStore((s) => s.folder);
  const revealStep = useStore((s) => s.revealStep);
  const presentStart = useStore((s) => s.presentStart);
  const flash = useStore((s) => s.flash);
  const endPresent = useStore((s) => s.endPresent);
  const presentRecording = useStore((s) => s.presentRecording);
  const presentAdvance = useStore((s) => s.presentAdvance);
  const presentReverse = useStore((s) => s.presentReverse);
  const jumpToRef = useStore((s) => s.jumpToRef);

  const page = computed.pages[current];
  const nextPage = computed.pages[current + 1];
  const size = PAGE_SIZE[deck.config.aspect];
  const pxW = (size.w * 96) / 25.4;
  const pxH = (size.h * 96) / 25.4;

  const orders = useMemo(() => pageOrders(page), [page]);
  const revealed = useMemo(() => new Set(orders.slice(0, revealStep)), [orders, revealStep]);

  const main = useFitScale(size.w, size.h);
  const next = useFitScale(size.w, size.h, 16);

  // 计时器 + 钟点
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = presentStart ? Math.max(0, Math.floor((now - presentStart) / 1000)) : 0;
  const clock = new Date(now).toLocaleTimeString('zh-CN', { hour12: false });

  // 演讲稿字号
  const [noteSize, setNoteSize] = useState(14);
  const notes = page?.kind === 'slide' ? page.slide?.notes : undefined;

  return (
    <div
      className="presenter"
      onWheel={(e) => {
        if (e.ctrlKey) return;
        if (e.deltaY > 0) presentAdvance();
        else if (e.deltaY < 0) presentReverse();
      }}
    >
      <div className="presenter-main" ref={main.ref}>
        {page && main.scale > 0 && (
          <div className="page-sizer" style={{ width: pxW * main.scale, height: pxH * main.scale }}>
            <div
              className="page-wrap"
              style={{ width: pxW, height: pxH, transform: `scale(${main.scale})`, transformOrigin: 'top left' }}
            >
              <SlideView
                page={page}
                deck={deck}
                computed={computed}
                folder={folder ?? ''}
                mode="preview"
                revealed={revealed}
                onRef={jumpToRef}
                highlightLabel={flash?.page === current ? flash.label : undefined}
              />
            </div>
          </div>
        )}
        {orders.length > 0 && (
          <div className="presenter-steps">
            动画 {revealStep}/{orders.length}
          </div>
        )}
      </div>
      <div className="presenter-side">
        <div className="presenter-block">
          <div className="presenter-label">下一页 <span className="pt-page">{(page?.no ?? 0)} / {computed.pages.length}</span></div>
          <div className="presenter-next" ref={next.ref}>
            {nextPage && next.scale > 0 ? (
              <div className="page-sizer" style={{ width: pxW * next.scale, height: pxH * next.scale }}>
                <div
                  style={{ width: pxW, height: pxH, transform: `scale(${next.scale})`, transformOrigin: 'top left', opacity: 0.9 }}
                >
                  <SlideView page={nextPage} deck={deck} computed={computed} folder={folder ?? ''} mode="preview" />
                </div>
              </div>
            ) : (
              <div className="presenter-nonext">（末页）</div>
            )}
          </div>
        </div>
        <div className="presenter-timer">
          <span className="pt-elapsed" title="已放映时长">{fmt(elapsed)}</span>
          <span className="pt-clock">{clock}</span>
        </div>
        <div className="presenter-block grow">
          <div className="presenter-label">
            演讲稿
            <span className="presenter-ns">
              <button onClick={() => setNoteSize((n) => Math.max(11, n - 1))}>A−</button>
              <button onClick={() => setNoteSize((n) => Math.min(24, n + 1))}>A+</button>
            </span>
          </div>
          <div className="presenter-notes" style={{ fontSize: noteSize }}>
            {notes || <span className="dim">（本页无演讲稿）</span>}
          </div>
        </div>
        <div className="presenter-ctl">
          <button
            className={'presenter-rec' + (presentRecording ? ' on' : '')}
            title={presentRecording ? '停止录制（自动保存 webm 到工程目录）' : '录制放映（60Hz · 系统声+麦克风 · 保存到工程目录）'}
            onClick={() => { window.api.sendPresentCtrl({ type: 'rec-toggle' }); }}
          >
            {presentRecording ? '■ 停止录制' : '● 录制放映'}
          </button>
          <button
            className="presenter-swap"
            title="交换放映/监看屏幕（多屏演讲时放映屏与监看屏互换）"
            onClick={() => { void window.api.swapPresentScreens(); }}
          >
            ⇄ 交换屏幕
          </button>
        </div>
        <button className="presenter-end" onClick={endPresent}>结束放映 (Esc)</button>
      </div>
    </div>
  );
}
