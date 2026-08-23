// 左侧页胶片（缩略图即大纲：含自动节分隔页）
// 页间插入条：悬停缝隙显示引导线与 ＋；菜单仅点击 ＋ 打开；
// 指针离开菜单区域 200ms、点击他处、或选中页型后关闭

import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { promptText } from './prompt';
import { SlideView } from './SlideView';
import { PAGE_SIZE } from '../model/types';

const THUMB_W = 152; // px

export function Filmstrip() {
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
            className={'thumb' + (p.index === current ? ' sel' : '')}
            onClick={() => gotoPage(p.index)}
            onContextMenu={(e) => {
              e.preventDefault();
              closeAll();
              setMenu({ x: e.clientX, y: e.clientY, pageIndex: p.index });
            }}
          >
            <div className="thumb-page" style={{ width: THUMB_W, height: thumbH }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <SlideView page={p} deck={deck} computed={computed} folder={folder ?? ''} mode="thumb" />
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
}
