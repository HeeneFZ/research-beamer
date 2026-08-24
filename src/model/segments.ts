// 段式双栏布局：块序列按 colmark/colend 标记切成 单栏段/双栏段

import { Block } from './types';

/** 段式布局：colmark 开双栏（第二个切右栏），colend 收栏回单栏 */
interface ColRegion {
  kind: 'cols';
  left: Block[];
  right: Block[];
  switched: boolean;
}
interface FullRegion {
  kind: 'full';
  blocks: Block[];
}
export type Segment = FullRegion | ColRegion;

export function buildSegments(blocks: Block[]): Segment[] {
  const segs: Segment[] = [];
  let full: FullRegion = { kind: 'full', blocks: [] };
  let cols: ColRegion | null = null;
  const flushFull = () => {
    if (full.blocks.length) segs.push(full);
    full = { kind: 'full', blocks: [] };
  };
  // 空栏区（左右皆无内容）不产出段：删光内容后残留的 colmark/colend 不再渲染
  // 栏区容器与分割线（否则编辑画布出现悬空虚线框）
  const flushCols = () => {
    if (cols && (cols.left.length || cols.right.length)) segs.push(cols);
    cols = null;
  };
  for (const b of blocks) {
    if (b.type === 'colmark') {
      if (!cols) {
        flushFull();
        cols = { kind: 'cols', left: [], right: [], switched: false };
      } else if (cols.switched) {
        flushCols();
        cols = { kind: 'cols', left: [], right: [], switched: false };
      } else {
        cols.switched = true;
      }
      continue;
    }
    if (b.type === 'colend') {
      flushCols();
      continue;
    }
    if (cols) {
      if (cols.switched) cols.right.push(b);
      else cols.left.push(b);
    } else {
      full.blocks.push(b);
    }
  }
  flushCols();
  flushFull();
  return segs;
}

/** 删除空栏区的全部标记（colmark×2 + colend）：删光栏内最后一块时自动收回双栏，
 *  避免残留标记永远留在 md 里（渲染层 buildSegments 已跳过空栏区，这里清数据源）。
 *  栏内有任何内容块则原样保留。 */
export function stripEmptyColRegions(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let regionStart = -1; // out 中本栏区首个标记的下标；-1 = 当前不在栏区
  let switched = false; // 本栏区已见切栏标记
  let hasContent = false;
  const settle = () => {
    if (regionStart < 0) return;
    if (!hasContent) out.length = regionStart; // 空栏区：整段标记丢弃
    regionStart = -1;
    switched = false;
    hasContent = false;
  };
  for (const b of blocks) {
    if (b.type === 'colmark') {
      if (regionStart < 0) {
        regionStart = out.length;
        out.push(b);
      } else if (!switched) {
        switched = true;
        out.push(b);
      } else {
        // 第三个 colmark：隐式收栏 + 开新栏区（buildSegments 同款状态机）
        settle();
        regionStart = out.length;
        out.push(b);
      }
      continue;
    }
    if (b.type === 'colend') {
      // 有内容的栏区保留收栏标记；空栏区连 colend 一起丢；孤立 colend（无开栏）直接清
      if (regionStart >= 0 && hasContent) out.push(b);
      settle();
      continue;
    }
    if (regionStart >= 0) hasContent = true;
    out.push(b);
  }
  settle();
  return out;
}

/** 块所属栏区（null = 单栏段）。与 buildSegments 同一状态机，判定口径永远一致。 */
export interface ColRegionAt {
  /** 点击块所在栏（切栏 colmark 之前 = 左栏） */
  col: 'l' | 'r';
  /** 开栏 colmark 下标 */
  openIdx: number;
  /** 切右栏 colmark 下标（左栏无内容时也可能存在） */
  switchIdx: number;
  /** 收栏 colend 下标；无显式收栏（页尾/下一栏区隐式收）= -1 */
  endIdx: number;
  /** 栏区最后一个内容块下标（标记块不算） */
  lastIdx: number;
}

/** 查 blockId 所属栏区：解析整页标记流（含隐式收栏：第三/下一个 colmark） */
export function colRegionAt(blocks: Block[], blockId: string): ColRegionAt | null {
  let openIdx = -1;
  let switchIdx = -1;
  let endIdx = -1;
  let lastIdx = -1;
  let hitCol: 'l' | 'r' | null = null;
  let result: ColRegionAt | null = null;
  const close = () => {
    if (hitCol && !result) result = { col: hitCol, openIdx, switchIdx, endIdx, lastIdx };
    openIdx = -1; switchIdx = -1; endIdx = -1; lastIdx = -1;
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'colmark') {
      if (openIdx < 0) openIdx = i;
      else if (switchIdx < 0) switchIdx = i;
      else { close(); openIdx = i; } // 第三标记：隐式收栏 + 开新栏区
      continue;
    }
    if (b.type === 'colend') {
      if (openIdx >= 0) { endIdx = i; close(); }
      continue; // 孤立 colend（无开栏）忽略，与 buildSegments 一致
    }
    if (openIdx >= 0) {
      lastIdx = i;
      if (b.id === blockId) hitCol = switchIdx >= 0 ? 'r' : 'l';
    }
  }
  close(); // 页尾仍开着的栏区
  return result;
}

/** 「结束双栏区」落点计划（纯函数，store.insertColEnd 消费）。
 *  语义与「开始双栏区」对称：点击块本身逃出栏区，成为收栏后首个单栏块——
 *  colend 插在点击块【之前】（旧行为插在其后：栏尾点击是零视觉变化的哑操作，
 *  后续 ＋ 插入仍落栏内；左栏点击会把栏区劈成两个、右栏内容被重释为新栏区左栏）。
 *  保留的栏区必须两侧都有内容（配对不变量）：切栏点前移后任一侧为空
 *  （如点击右栏首块、或左栏首块）→ 整个栏区拆除、所有块回单栏（insertAt=-1）。
 *  删除项：旧 colend（收栏点已前移，留着是孤立标记）；点左栏时切栏标记
 *  （否则其后右栏内容被重释为新栏区左栏——分裂损坏）。
 *  返回 null = 点击块不在栏区内（调用方应 disable 而非静默失效）。 */
export function colEndPlan(blocks: Block[], blockId: string): { insertAt: number; deleteIdx: number[] } | null {
  const r = colRegionAt(blocks, blockId);
  if (!r) return null;
  const xi = blocks.findIndex((b) => b.id === blockId);
  if (xi < 0) return null;
  const isContent = (i: number) => blocks[i].type !== 'colmark' && blocks[i].type !== 'colend';
  const anyContent = (from: number, to: number) => {
    for (let i = Math.max(from, 0); i < to; i++) if (isContent(i)) return true;
    return false;
  };
  // 切栏点（新 colend 落点）：点击左栏块 → 切栏标记作废，栏区止于开栏标记；
  // 点击右栏块 → 切栏标记保留，栏区止于点击块
  const cutAt = r.col === 'l' ? r.openIdx : xi;
  // 保留栏区的左/右栏内容（配对检查）：左栏 = 开栏后…cutAt；右栏 = 切栏后…xi（仅点右栏时存在）
  const leftHas = anyContent(r.openIdx + 1, cutAt);
  const rightHas = r.col === 'r' && anyContent(r.switchIdx + 1, xi);
  const deleteIdx: number[] = [];
  if (r.endIdx >= 0) deleteIdx.push(r.endIdx);
  if (!leftHas || !rightHas) {
    // 拆除整个栏区：左右标记全清，所有块回单栏
    deleteIdx.push(r.openIdx);
    if (r.switchIdx >= 0) deleteIdx.push(r.switchIdx);
    return { insertAt: -1, deleteIdx };
  }
  // 配对保留：栏区止于点击块（点左栏时无配对可能，恒走拆除分支——此行仅点右栏可达）
  return { insertAt: xi, deleteIdx };
}
