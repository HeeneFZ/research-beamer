// 左侧页胶片（缩略图即大纲：含自动节分隔页）
// 页间插入条：悬停缝隙显示引导线与 ＋；菜单仅点击 ＋ 打开；
// 指针离开菜单区域 200ms、点击他处、或选中页型后关闭

import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { promptText } from './prompt';
import { SlideView, referenceSignature } from './SlideView';
import { Deck, PAGE_SIZE, Page } from '../model/types';

const THUMB_W = 152; // px

const sectionSignatures = new WeakMap<Deck, string>();
function sectionSignature(deck: Deck): string {
  let signature = sectionSignatures.get(deck);
  if (signature == null) {
    signature = JSON.stringify(deck.items.filter((item) => item.kind === 'section'));
    sectionSignatures.set(deck, signature);
  }
  return signature;
}

/** 全部缩略页继续挂载与扫描；只跳过内容、编号和章节上下文未变化的页树。 */
const ThumbnailSlide = memo(SlideView, (a, b) => {
  if (a.deck.config !== b.deck.config || a.folder !== b.folder
    || a.page.kind !== b.page.kind || a.page.index !== b.page.index || a.page.no !== b.page.no
    || a.page.slide !== b.page.slide || a.page.section !== b.page.section
    || a.computed.pages.length !== b.computed.pages.length
    || a.page.sectionPath.length !== b.page.sectionPath.length
    || a.page.sectionPath.some((section, i) => section !== b.page.sectionPath[i])
    || referenceSignature(a.computed) !== referenceSignature(b.computed)) return false;
  // 目录与章节卡片还读取其它章节/小节；普通内容页只读其 sectionPath。
  if (a.page.kind === 'divider' || a.page.slide?.layout === 'toc') {
    return sectionSignature(a.deck) === sectionSignature(b.deck);
  }
  return true;
});

/** 拖拽落点换算：page → 作为 moveSlide 目标的 slide（divider→其后首个内容 slide；
 *  title/toc/end 特殊页 → null（不可作落点） */
function dropTargetSlideOf(p: Page, pages: Page[]): string | null {
  if (p.kind === 'slide' && p.slide) {
    const l = p.slide.layout;
    if (l === 'title' || l === 'toc' || l === 'end') return null;
    return p.slide.id;
  }
  // divider：其后第一个内容 slide；相邻节标题/特殊页 → null（不可作落点）
  for (let i = p.index + 1; i < pages.length; i++) {
    const q = pages[i];
    if (q.kind === 'divider') return null;
    if (q.kind === 'slide' && q.slide && !['title', 'toc', 'end'].includes(q.slide.layout)) return q.slide.id;
  }
  return null;
}


export const Filmstrip = memo(function Filmstrip() {
  const deck = useStore((s) => s.deck);
  const computed = useStore((s) => s.computed);
  const current = useStore((s) => s.current);
  const folder = useStore((s) => s.folder);
  const gotoPage = useStore((s) => s.gotoPage);
  const addSlide = useStore((s) => s.addSlide);
  const deleteSlide = useStore((s) => s.deleteSlide);
  const duplicateSlide = useStore((s) => s.duplicateSlide);
  const renameSection = useStore((s) => s.renameSection);
  const [menu, setMenu] = useState<{ x: number; y: number; pageIndex: number } | null>(null);
  const [stripMenu, setStripMenu] = useState<{ x: number; y: number; afterIndex: number } | null>(null);
  // 拖拽换序：dragPage=拖动源页 index；dropHint=当前悬停落点页 index（null=无有效落点）
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<number | null>(null);
  const dragSrcRef = useRef<string | null>(null); // 拖动源 slideId（dataTransfer 在部分场景读不到）
  const size = PAGE_SIZE[deck.config.aspect];
  const pxW = (size.w * 96) / 25.4;
  const pxH = (size.h * 96) / 25.4;
  const scale = THUMB_W / pxW;
  const thumbH = Math.round(pxH * scale);

  const closeAll = () => {
    setMenu(null);
    setStripMenu(null);
  };

  // 菜单打开期间：点击菜单外任意处 / Esc 关闭（stripMenu 原有 200ms 指针离开自动关闭保留，
  // 本 effect 补齐 ctx 页菜单的关闭通道与两者的外点/Esc 统一语义）
  useEffect(() => {
    if (!menu && !stripMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.menu-drop.ctx, .strip-menu')) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu != null, stripMenu != null]);

  // 插入菜单打开期间：指针离开菜单区域（含容差）200ms 后自动关闭
  useEffect(() => {
    if (!stripMenu) return;
    let t: number | undefined;
    const onMove = (e: MouseEvent) => {
      const el = document.querySelector('.strip-menu') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inside =
        e.clientX >= r.left - 8 && e.clientX <= r.right + 8 &&
        e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8;
      if (inside) {
        clearTimeout(t);
        t = undefined;
      } else if (t === undefined) {
        t = window.setTimeout(() => setStripMenu(null), 200);
      }
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      clearTimeout(t);
    };
  }, [stripMenu]);

  return (
    <div className="filmstrip" onClick={closeAll}>
      <div className="filmstrip-title">页面大纲</div>
      {computed.pages.map((p, i) => (
        <div key={p.index}>
          <div
            className={'thumb' + (p.index === current ? ' sel' : '') + (dragPage === p.index ? ' dragging' : '') + (dropHint === p.index ? ' drop-hint' : '')}
            draggable={p.kind === 'slide' && p.slide != null && !['title', 'toc', 'end'].includes(p.slide.layout)}
            onDragStart={(e) => {
              if (!p.slide) return;
              dragSrcRef.current = p.slide.id;
              setDragPage(p.index);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', p.slide.id);
            }}
            onDragEnd={() => { setDragPage(null); setDropHint(null); dragSrcRef.current = null; }}
            onDragOver={(e) => {
              if (dragSrcRef.current == null) return;
              const target = dropTargetSlideOf(p, computed.pages);
              if (target == null || target === dragSrcRef.current) { setDropHint(null); return; }
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropHint(p.index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const src = dragSrcRef.current ?? e.dataTransfer.getData('text/plain');
              const target = dropTargetSlideOf(p, computed.pages);
              if (src && target && target !== src) useStore.getState().moveSlide(src, target);
              setDragPage(null); setDropHint(null); dragSrcRef.current = null;
            }}
            onClick={() => gotoPage(p.index)}
            onContextMenu={(e) => {
              e.preventDefault();
              closeAll();
              setMenu({ x: e.clientX, y: e.clientY, pageIndex: p.index });
            }}
          >
            <div className="thumb-page" style={{ width: THUMB_W, height: thumbH }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <ThumbnailSlide page={p} deck={deck} computed={computed} folder={folder ?? ''} mode="thumb" layoutAuthority />
              </div>
            </div>
            <div className="thumb-no">
              {p.kind === 'divider' ? <span className="thumb-mark">§</span> : null}
              {p.no}
            </div>
          </div>
          {i < computed.pages.length - 1 && (
            <div className="strip-insert">
              <button
                className="strip-plus"
                title="在此页后插入"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  // 再次点击同一 ＝ 关闭；点击其他 ＝ 切换目标
                  setStripMenu((m) =>
                    m && m.afterIndex === p.index ? null : { x: r.left, y: r.bottom + 4, afterIndex: p.index },
                  );
                }}
              >＋</button>
            </div>
          )}
        </div>
      ))}
      <div className="filmstrip-add">
        <button className="tb-btn" onClick={() => { closeAll(); addSlide('content', computed.pages.length - 1); }}>＋ 新建页</button>
      </div>
      {stripMenu && (
        <div
          className="strip-menu"
          style={{ left: stripMenu.x, top: stripMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bmi" onClick={() => { addSlide('content', stripMenu.afterIndex); setStripMenu(null); }}>内容页</div>
          <div className="bmi" onClick={() => { addSlide('twoCol', stripMenu.afterIndex); setStripMenu(null); }}>双栏页</div>
          <div className="bmi" onClick={() => { addSlide('title', stripMenu.afterIndex); setStripMenu(null); }}>标题页</div>
          <div className="bmi" onClick={() => { addSlide('toc', stripMenu.afterIndex); setStripMenu(null); }}>目录页</div>
          <div className="bmi" onClick={() => { addSlide('end', stripMenu.afterIndex); setStripMenu(null); }}>结尾页</div>
        </div>
      )}
      {menu && (
        <div className="menu-drop ctx" style={{ left: menu.x, top: menu.y }}>
          {computed.pages[menu.pageIndex]?.kind === 'slide' && (
            <>
              <div className="menu-item" onClick={() => duplicateSlide(computed.pages[menu.pageIndex].slide!.id)}>复制页</div>
              <div className="menu-item" onClick={() => deleteSlide(computed.pages[menu.pageIndex].slide!.id)}>删除页</div>
              {['content', 'twoCol'].includes(computed.pages[menu.pageIndex].slide!.layout) && (
                <div className="menu-item" onClick={async () => {
                  // 页面字号：正文区占全局标准的百分比（60–150；100 = 恢复标准）
                  const sl = computed.pages[menu.pageIndex].slide!;
                  closeAll(); // ctx 菜单 z-index 高于模态遮罩，先关再弹
                  const v = await promptText('本页正文区字号：占全局标准的百分比（60–150，100 = 标准）', String(Math.round((sl.fontScale ?? 1) * 100)));
                  if (v === null) return;
                  const n = parseFloat(v);
                  if (!Number.isFinite(n)) return;
                  const pct = Math.min(150, Math.max(60, n));
                  useStore.getState().updateSlide(sl.id, { fontScale: Math.abs(pct - 100) < 0.5 ? undefined : Math.round(pct) / 100 });
                }}>页面字号…</div>
              )}
            </>
          )}
          {computed.pages[menu.pageIndex]?.kind === 'divider' && (
            <>
              <div className="menu-item" onClick={async () => {
                const sec = computed.pages[menu.pageIndex].section!;
                closeAll(); // ctx 菜单 z-index 高于模态遮罩，先关再弹
                const t = await promptText('重命名节', sec.title);
                if (t && t.trim()) renameSection(sec.id, t.trim());
              }}>重命名节</div>
              <div className="menu-item dim">自动节分隔页（由「# 节标题」生成）</div>
            </>
          )}
        </div>
      )}
    </div>
  );
});
