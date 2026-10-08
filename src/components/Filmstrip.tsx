// 左侧页胶片（缩略图即大纲：含自动节分隔页）
// 页间插入条：悬停缝隙显示引导线与 ＋；菜单仅点击 ＋ 打开；
// 指针离开菜单区域 200ms、点击他处、或选中页型后关闭

import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { promptText } from './prompt';
import { Popover, elementAnchor } from './Popover';
import type { AnchorRect } from './OrderPicker';
import { SlideView, referenceSignature } from './SlideView';
import { Deck, PAGE_SIZE } from '../model/types';
import { OutlineAnchor, OutlineRow, OutlineSource, outlineRows, planOutlineMove } from '../model/outline';

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
  const [stripMenu, setStripMenu] = useState<{ anchor: AnchorRect; afterIndex: number } | null>(null);
  const [dragSource, setDragSource] = useState<OutlineSource | null>(null);
  const dragRef = useRef<OutlineSource | null>(null);
  const [dropHint, setDropHint] = useState<{ key: string; anchor: OutlineAnchor; label: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = outlineRows(deck, computed);
  const endDrag = () => { dragRef.current = null; setDragSource(null); setDropHint(null); };
  const anchorOf = (row: OutlineRow, after: boolean): OutlineAnchor | null => {
    const source = dragRef.current;
    if (!source) return null;
    if (source.kind === 'slide') {
      if (row.section) return { kind: 'section', id: row.section.id, position: 'inside' };
      if (row.page?.slide) return { kind: 'slide', id: row.page.slide.id, position: after ? 'after' : 'before' };
      return null;
    }
    const section = deck.items.find((item) => item.kind === 'section' && item.section.id === source.id);
    if (section?.kind !== 'section') return null;
    const peer = row.path.find((item) => item.level === section.section.level);
    if (peer) return { kind: 'section', id: peer.id, position: after ? 'after' : 'before' };
    const parent = row.path.find((item) => item.level === section.section.level - 1);
    return parent ? { kind: 'section', id: parent.id, position: 'inside' } : null;
  };
  useEffect(() => {
    if (!dragSource) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') endDrag(); };
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', endDrag);
    return () => { window.removeEventListener('keydown', cancel); window.removeEventListener('blur', endDrag); };
  }, [dragSource]);
  const size = PAGE_SIZE[deck.config.aspect];
  const pxW = (size.w * 96) / 25.4;
  const pxH = (size.h * 96) / 25.4;


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
      if (t?.closest?.('.menu-drop.ctx, .strip-menu, [data-popover-trigger]')) return;
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

  return (
    <div className="filmstrip" onClick={closeAll}>
      <div className="filmstrip-title">页面大纲</div>
      {rows.map((row) => {
        const page = row.page;
        const hidden = row.path.some((section) => section.id !== row.section?.id && (collapsed.has(section.id) || dragSource?.kind === 'section' && dragSource.id === section.id));
        const width = THUMB_W - row.depth * 9;
        const scale = width / pxW;
        const height = Math.round(pxH * scale);
        const draggable = !!row.section || !!page?.slide && ['content', 'twoCol'].includes(page.slide.layout);
        return (
          <div key={row.key} className={'outline-row' + (hidden ? ' folded' : '')}
            data-outline-id={row.key} data-depth={row.depth} style={{ marginLeft: row.depth * 9 }}
            draggable={draggable}
            onDragStart={(event) => {
              const source: OutlineSource = { kind: row.section ? 'section' : 'slide', id: row.key };
              dragRef.current = source; setDragSource(source); setDropHint(null);
              event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.key);
            }}
            onDragEnd={endDrag}
            onDragOver={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const anchor = anchorOf(row, event.clientY > rect.top + rect.height / 2);
              const source = dragRef.current;
              const plan = source && anchor ? planOutlineMove(deck.items, source, anchor) : null;
              if (!plan || !anchor) { setDropHint(null); return; }
              event.preventDefault(); event.dataTransfer.dropEffect = 'move';
              const path = plan.path.map((section) => section.title).join(' › ');
              const label = source?.kind === 'section' ? `整组移动${anchor.position === 'after' ? '到此章节之后' : anchor.position === 'inside' ? '到此章节内' : '到此章节之前'}` : `移入：${path || '未分组'}`;
              setDropHint({ key: row.key, anchor, label });
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragRef.current && dropHint?.key === row.key) useStore.getState().moveOutline(dragRef.current, dropHint.anchor);
              endDrag();
            }}>
            {row.section && <div className="outline-heading" title="拖动可连同本节所有内容一起移动">
              <button className="outline-toggle" aria-expanded={!collapsed.has(row.section.id)} onClick={(event) => {
                event.stopPropagation(); const id = row.section!.id;
                setCollapsed((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
              }}>{collapsed.has(row.section.id) ? '▸' : '▾'}</button>
              <button className="outline-heading-name" onClick={() => {
                const index = computed.sectionPageIndex.get(row.section!.id);
                if (index != null) gotoPage(index);
              }}>{computed.sectionNum.get(row.section.id)} {row.section.title}</button>
              <span className="outline-grip" aria-hidden="true">⠿</span>
            </div>}
            {page && <div className={'thumb' + (page.index === current ? ' sel' : '') + (dragSource?.id === row.key ? ' dragging' : '')}
              onClick={() => gotoPage(page.index)} onContextMenu={(event) => {
                event.preventDefault(); closeAll(); setMenu({ x: event.clientX, y: event.clientY, pageIndex: page.index });
              }}>
              <div className="thumb-page" style={{ width, height }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                  <ThumbnailSlide page={page} deck={deck} computed={computed} folder={folder ?? ''} mode="thumb" layoutAuthority />
                </div>
              </div>
              <div className="thumb-no">{page.kind === 'divider' ? <span className="thumb-mark">§</span> : null}{page.no}</div>
            </div>}
            {dropHint?.key === row.key && <div className={`outline-drop-hint drop-${dropHint.anchor.position}`}>{dropHint.label}</div>}
            {page && <div className="strip-insert"><button className="strip-plus" data-popover-trigger aria-haspopup="menu" title="在此页后插入"
              onClick={(event) => { event.stopPropagation(); const anchor = elementAnchor(event.currentTarget);
                setStripMenu((old) => old?.afterIndex === page.index ? null : { anchor, afterIndex: page.index }); }}>＋</button></div>}
          </div>
        );
      })}
      <div className="filmstrip-add">
        <button className="tb-btn" data-popover-trigger aria-haspopup="menu" onClick={(e) => { const anchor = elementAnchor(e.currentTarget); setStripMenu((old) => old ? null : { anchor, afterIndex: computed.pages.length - 1 }); }}>＋ 新建页面 ▾</button>
      </div>
      {stripMenu && (
        <Popover anchor={stripMenu.anchor} className="strip-menu" role="menu" onClose={() => setStripMenu(null)}>
          {([['content', '内容页'], ['twoCol', '双栏页'], ['title', '封面页'], ['toc', '目录页'], ['end', '结尾页']] as const).map(([layout, name]) => (
            <button key={layout} className="bmi" role="menuitem" onClick={() => { addSlide(layout, stripMenu.afterIndex); setStripMenu(null); }}>{name}</button>
          ))}
        </Popover>
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
