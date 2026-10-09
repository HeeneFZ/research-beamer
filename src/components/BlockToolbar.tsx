// 块快捷工具栏：portal 到 body 的浮层（不被页面 overflow:hidden 裁切）。
// 自包含 hover 检测（document 委托）；显示期间 10fps 同步位置（值比较防无效重渲）；
// 指针离开块与工具栏 260ms 后隐藏（CSS 桥填充间隙防误隐藏）。
// ＋菜单与 @ 引用选择器同款家族样式。

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { moveTargetOf, useStore } from '../state/store';
import { Block, Slide } from '../model/types';
import { colRegionAt } from '../model/segments';
import { IcoUp, IcoDown, IcoCopy, IcoPaste, IcoPlus, IcoTrash } from './icons';
import { promptText } from './prompt';
import { INSERT_ITEMS, insertBlockByKey, InsertKey } from './insertItems';

export function BlockToolbar({ slide, block }: {
  slide: Slide; block: Block;
}) {
  const moveBlockBefore = useStore((s) => s.moveBlockBefore);
  const deleteBlock = useStore((s) => s.deleteBlock);
  const updateBlock = useStore((s) => s.updateBlock);
  const active = useStore((s) => !s.presenting && s.computed.pages[s.current]?.slide?.id === slide.id);
  const [visible, setVisible] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const keepRef = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const barRef = useRef<HTMLDivElement>(null);

  const syncPos = () => {
    // 作用域限定编辑画布：胶片缩略图渲染同 data-bid 且 DOM 序在前，
    // 全局 querySelector 会命中缩略图导致工具栏漂移到侧栏
    const el = document.querySelector(`.editor-canvas [data-bid="${block.id}"]`) as HTMLElement | null;
    const bar = barRef.current;
    if (!el || !bar) return;
    const r = el.getBoundingClientRect();
    const bw = bar.offsetWidth || 190;
    const left = Math.max(8, Math.min(r.right - bw, window.innerWidth - bw - 8));
    const top = Math.max(8, r.top - bar.offsetHeight - 6);
    // 值比较：位置未变不 setState（避免周期性无效重渲闪烁）
    setPos((p) => (p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top }));
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!keepRef.current) {
        setVisible(false);
        setMenu(false);
      }
    }, 260);
  };
  const cancelHide = () => {
    clearTimeout(hideTimer.current);
    keepRef.current = false;
  };

  // hover 检测（document 委托；块卸载/重排后依然有效）
  useEffect(() => {
    if (!active) { keepRef.current = false; setVisible(false); setMenu(false); return; }
    const over = (e: MouseEvent) => {
      // 限定编辑画布（与 syncPos 同款前缀）：悬停胶片缩略图里的同 id 副本时，
      // 工具条会闪现在侧栏缩略图位置
      const el = (e.target as HTMLElement).closest?.(`.editor-canvas [data-bid="${block.id}"]`) as HTMLElement | null;
      if (!el) return;
      cancelHide();
      setVisible(true);
      // 初始位置直接从块元素算（不依赖未挂载的 bar）；rAF 循环随后接管精调
      const r = el.getBoundingClientRect();
      setPos((p) => p ?? { left: Math.max(8, Math.min(r.right - 190, window.innerWidth - 198)), top: Math.max(8, r.top - 62) });
    };
    const out = (e: MouseEvent) => {
      const t = e.relatedTarget as HTMLElement | null;
      if (t?.closest?.(`[data-bid="${block.id}"]`)) return;
      scheduleHide();
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      clearTimeout(hideTimer.current);
    };
  }, [block.id, active]);

  // 显示期间 10fps 同步位置（块被调序/插入/窗口缩放后跟随）
  useEffect(() => {
    if (!visible || !active) return;
    let alive = true;
    let last = 0;
    const tick = (t: number) => {
      if (!alive) return;
      if (t - last > 100) { syncPos(); last = t; }
      requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [visible, active]);

  const insert = (key: InsertKey) => {
    insertBlockByKey(slide.id, block.id, key);
    setMenu(false);
  };

  const setOrder = async () => {
    const v = await promptText('出现顺序（1 起，相同同时出现；留空清除）', block.order != null ? String(block.order) : '');
    if (v === null) return;
    const o = parseInt(v, 10);
    updateBlock(slide.id, block.id, { order: Number.isFinite(o) && o >= 1 ? o : undefined });
  };

  const colVisible = slide.blocks.filter((b) => b.type !== 'colmark' && b.type !== 'colend');
  const myPos = colVisible.findIndex((b) => b.id === block.id);
  const upNeighbor = myPos > 0 ? colVisible[myPos - 1] : null;
  const downNeighbor = myPos >= 0 && myPos < colVisible.length - 1 ? colVisible[myPos + 1] : null;
  const afterDown = myPos >= 0 && myPos < colVisible.length - 2 ? colVisible[myPos + 2] : null;
  // 跨栏段移动不支持：按钮须 disable 而非点击后静默失效（判定与 store 共用 moveTargetOf）
  const canUp = upNeighbor != null && moveTargetOf(slide.blocks, block.id, upNeighbor.id) != null;
  const canDown = downNeighbor != null && moveTargetOf(slide.blocks, block.id, afterDown ? afterDown.id : null) != null;
  // 结束双栏区只对栏内块有意义：栏外点击应 disable（判定与 store 共用 colRegionAt）
  const canColEnd = colRegionAt(slide.blocks, block.id) != null;
  // 块剪贴板（复制/粘贴按钮）：订阅 clipBlock 驱动粘贴按钮可用态
  const clipBlock = useStore((s) => s.clipBlock);
  const pasteBlock = () => {
    const s = useStore.getState();
    const id = s.pasteBlockAfter(slide.id, block.id);
    if (id != null && (s.clipBlock?.type === 'paragraph' || s.clipBlock?.type === 'itemize')) {
      s.setFocus(id, 'start');
    }
  };

  if (!active || !visible || !pos) return null;

  return createPortal(
    <>
      <div
        ref={barRef}
        className="btools-float"
        style={{ left: pos.left, top: pos.top }}
        onMouseEnter={() => { keepRef.current = true; clearTimeout(hideTimer.current); }}
        onMouseLeave={() => { keepRef.current = false; scheduleHide(); }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button disabled={!canUp} title={upNeighbor && !canUp ? '已到栏顶（跨栏调序不支持）' : '上移'} onClick={() => canUp && moveBlockBefore(slide.id, block.id, upNeighbor!.id)}><IcoUp /></button>
        <button disabled={!canDown} title={downNeighbor && !canDown ? '已到栏底（跨栏调序不支持）' : '下移'} onClick={() => canDown && moveBlockBefore(slide.id, block.id, afterDown ? afterDown.id : null)}><IcoDown /></button>
        <button title="复制块（粘贴到任意块之后）" onClick={() => { useStore.getState().copyBlock(slide.id, block.id); useStore.getState().setFlashMsg('已复制块：在目标块的 复制→粘贴 处粘贴'); }}><IcoCopy /></button>
        <button disabled={!clipBlock} title={clipBlock ? `粘贴${clipBlock.type === 'paragraph' ? '段落' : clipBlock.type === 'itemize' ? '列表' : clipBlock.type === 'equation' ? '公式' : clipBlock.type === 'annoeq' ? '注释公式' : clipBlock.type === 'figure' ? '图片' : clipBlock.type === 'video' ? '视频' : '表格'}到此处（此块之后）` : '剪贴板为空（先用复制按钮复制一个块）'} onClick={pasteBlock}><IcoPaste /></button>
        <button title="插入" className={menu ? 'on' : ''} onClick={() => setMenu(!menu)}><IcoPlus /></button>
        <button title="删除" className="danger" onClick={() => deleteBlock(slide.id, block.id)}><IcoTrash /></button>
      </div>
      {menu && (
        <div
          className="btools-menu-float"
          style={{ left: pos.left, top: pos.top + 60 }}
          onMouseEnter={() => { keepRef.current = true; clearTimeout(hideTimer.current); }}
          onMouseLeave={() => { keepRef.current = false; scheduleHide(); }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ref-picker-title">插入（在此块之后）</div>
          {INSERT_ITEMS.map((it) => {
            const dis = it.key === 'colend' && !canColEnd;
            return (
              <div
                key={it.key}
                className={'ref-picker-item' + (dis ? ' disabled' : '')}
                title={dis ? '当前块不在双栏区内' : undefined}
                onMouseDown={(e) => { e.preventDefault(); if (!dis) insert(it.key); }}
              >
                <span className={`ref-kind slash-badge-${it.cls}`}>{it.badge}</span>
                <span>{it.label}</span>
                <span className="slash-hint">{dis ? '不在双栏区内' : it.hint}</span>
              </div>
            );
          })}
          <div className="ref-picker-item" onMouseDown={(e) => { e.preventDefault(); void setOrder(); setMenu(false); }}>
            <span className="ref-kind slash-badge-cite">⏱</span>
            <span>出现顺序…</span>
            <span className="slash-hint">{block.order != null ? `当前 ${block.order}` : '动画'}</span>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
