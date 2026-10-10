// 演讲者视图（放映时主窗口的内容区）：当前页 + 下一页预览 + 演讲稿 + 计时器
// 缩放用 page-sizer 模式（外层缩放后尺寸占位，内层 transform origin top-left），
// 修复内容跑出容器的问题；滚轮翻页。

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pageOrders, useStore } from '../state/store';
import { ReadySlideStage } from './ReadySlideStage';
import { useScreenPreparation } from '../hooks/useScreenPreparation';
import { PAGE_SIZE } from '../model/types';
import { emptyViewPreparation, type ViewPreparation } from '../model/mediaResources';

export type PresenterSnapshot = Pick<ReturnType<typeof useStore.getState>, 'deck' | 'computed' | 'current' | 'folder' | 'revealStep' | 'flash' | 'presentStart' | 'mediaPreparation' | 'mediaRevision' | 'pageLayout'>;

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

export const PresenterView = memo(function PresenterView({ active, snapshot, onPreparation }: { active: boolean; snapshot: PresenterSnapshot; onPreparation?: (state: ViewPreparation) => void }) {
  const { deck, computed, current, folder, revealStep, presentStart, flash, mediaPreparation: preparation, mediaRevision: revision, pageLayout } = snapshot;
  const endPresent = useStore((s) => s.endPresent);
  const presentRecording = useStore((s) => s.presentRecording);
  const presentAdvance = useStore((s) => s.presentAdvance);
  const presentReverse = useStore((s) => s.presentReverse);
  const jumpToRef = useStore((s) => s.jumpToRef);
  const [mainStage, setMainStage] = useState(emptyViewPreparation);
  const [nextStage, setNextStage] = useState(emptyViewPreparation);

  const page = computed.pages[current];
  const nextPage = computed.pages[current + 1];
  const size = PAGE_SIZE[deck.config.aspect];
  const pxW = (size.w * 96) / 25.4;
  const pxH = (size.h * 96) / 25.4;

  const orders = useMemo(() => pageOrders(page), [page]);
  const revealed = useMemo(() => new Set(orders.slice(0, revealStep)), [orders, revealStep]);
  const hasNextAnimation = revealStep < orders.length;
  const previewPage = hasNextAnimation ? page : nextPage;
  const previewRevealed = useMemo(() => new Set(hasNextAnimation ? orders.slice(0, revealStep + 1) : []), [hasNextAnimation, orders, revealStep]);

  const main = useFitScale(size.w, size.h);
  const next = useFitScale(size.w, size.h, 16);
  const screen = useScreenPreparation(computed.pages, current, folder ?? '', preparation, pxW * main.scale, pxH * main.scale, active, pxW, false, false);
  useLayoutEffect(() => {
    const scope = String(revision);
    const rightReady = !previewPage || nextStage.scope === scope && nextStage.ready;
    onPreparation?.({ scope, targetKey: mainStage.targetKey, ready: screen.ready && (!page || mainStage.scope === scope && mainStage.ready && rightReady),
      currentReady: !page || mainStage.currentReady, completed: mainStage.completed + nextStage.completed,
      total: mainStage.total + nextStage.total });
  }, [revision, screen.ready, screen.completed, screen.total, mainStage, nextStage, !!page, !!previewPage, onPreparation]);

  // 计时器 + 钟点
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const elapsed = presentStart ? Math.max(0, Math.floor((now - presentStart) / 1000)) : 0;
  const clock = new Date(now).toLocaleTimeString('zh-CN', { hour12: false });

  // 演讲稿字号
  const [noteSize, setNoteSize] = useState(14);
  const notes = page?.kind === 'slide' ? page.slide?.notes : undefined;

  return (
    <div
      className="presenter"
      onWheel={(e) => {
        if (e.ctrlKey || !active) return;
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
              <ReadySlideStage
                active={active}
                preloadPages={computed.pages}
                onPreparation={setMainStage}
                layoutSnapshot={pageLayout}
                mediaSnapshot={revision}
                resourceSnapshot={preparation}
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
        <div className="presenter-top-actions">
          <button className="presenter-swap" title="交换放映和监看屏幕"
            onClick={async () => {
              const result = await window.api.swapPresentScreens();
              if (!result.ok) useStore.getState().setFlashMsg(result.error === 'single-display' ? '需要连接两个显示器才能交换屏幕' : '请将两个窗口放在不同的屏幕上再交换');
            }}>⇄ 交换屏幕</button>
          <button className="presenter-end" onClick={endPresent}>结束放映</button>
        </div>
        <div className="presenter-block">
          <div className="presenter-label">{hasNextAnimation ? '下一步动画' : '下一页'} <span className="pt-page">{(page?.no ?? 0)} / {computed.pages.length}</span></div>
          <div className="presenter-next" ref={next.ref}>
            {page && next.scale > 0 && (
              <div className="page-sizer" aria-hidden={!previewPage || undefined} style={{ width: pxW * next.scale, height: pxH * next.scale, visibility: previewPage ? 'visible' : 'hidden' }}>
                <div
                  style={{ width: pxW, height: pxH, transform: `scale(${next.scale})`, transformOrigin: 'top left', opacity: 0.9 }}
                >
                  <ReadySlideStage active={active && !!previewPage} preloadPages={computed.pages} onPreparation={setNextStage} layoutSnapshot={pageLayout} mediaSnapshot={revision} resourceSnapshot={preparation} page={previewPage ?? page} deck={deck} computed={computed} folder={folder ?? ''} mode="preview" revealed={previewRevealed} />
                </div>
              </div>
            )}
            {!previewPage && <div className="presenter-nonext" style={{ position: 'absolute' }}>（末页）</div>}
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
        </div>
      </div>
    </div>
  );
});
