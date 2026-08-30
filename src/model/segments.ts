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
    // 空白占位段不算内容：两侧只剩占位（用户删光了实际内容）时栏区整体收回
    //（README 合约「删光双栏区内全部内容自动收回」）；占位段本身照常保留——
    // 另一侧有内容时它正是空侧的可点击落块目标（deleteBlock 后接 reseed 补种）
    if (regionStart >= 0 && !(b.type === 'paragraph' && !(b.text || '').trim())) hasContent = true;
    out.push(b);
  }
  settle();
  return out;
}

/** 解析后补栏占位段：md 空段落在序列化时落为空行、解析时被跳过——栏区的
 *  空占位段（开栏时由 insertColRegion 种下的可点击目标）在保存/重开一轮后
 *  消失，右栏从此无处落块（＋/斜杠插入都落在左栏）。本函数在解析产物上
 *  把「开栏标记与切栏标记之间无内容块」的左侧、「切栏标记与收栏/页尾之间
 *  无内容块」的右侧各补一个空段落，恢复占位（serialize 再丢、parse 再补，
 *  md 层幂等）。与 stripEmptyColRegions 同款状态机口径。 */
export function reseedColPlaceholders(blocks: Block[], mkId: () => string): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type !== 'colmark') { out.push(b); i++; continue; }
    // 开栏标记：吞到切栏/收栏/页尾，左栏无内容则补占位（无后续切栏的悬空
    // colmark 由 stripEmptyColRegions 语义兜底，此处不处理）
    out.push(b); i++;
    let leftContent = false;
    while (i < blocks.length && blocks[i].type !== 'colmark' && blocks[i].type !== 'colend') {
      leftContent = true; out.push(blocks[i]); i++;
    }
    if (!leftContent && i < blocks.length && blocks[i].type === 'colmark') {
      out.push({ id: mkId(), type: 'paragraph', text: '' });
    }
    if (i >= blocks.length || blocks[i].type !== 'colmark') continue; // colend/页尾：收
    out.push(blocks[i]); i++; // 切栏标记
    let rightContent = false;
    while (i < blocks.length && blocks[i].type !== 'colmark' && blocks[i].type !== 'colend') {
      rightContent = true; out.push(blocks[i]); i++;
    }
    if (!rightContent) out.push({ id: mkId(), type: 'paragraph', text: '' });
  }
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
  // 结构配对用「块存在」（含空白占位——占位也是栏内实体，[M,L,M,b,R] 点 R
  // 应保留 [L|b]）；内容判定单独做：保留区间内无任何实际内容（两侧皆占位）
  // 才拆——与 stripEmptyColRegions「空白占位段不算内容」同口径（R8 修正：
  // 直接把空白排除塞进 rightHas 会误拆有真实左内容的栏区，且与镜像不对称）
  const isBlock = (i: number) => blocks[i].type !== 'colmark' && blocks[i].type !== 'colend';
  const isReal = (i: number) =>
    blocks[i].type !== 'colmark' && blocks[i].type !== 'colend'
    && !(blocks[i].type === 'paragraph' && !(blocks[i].text || '').trim());
  const anyBlock = (from: number, to: number) => {
    for (let i = Math.max(from, 0); i < to; i++) if (isBlock(i)) return true;
    return false;
  };
  const anyReal = (from: number, to: number) => {
    for (let i = Math.max(from, 0); i < to; i++) if (isReal(i)) return true;
    return false;
  };
  // 切栏点（新 colend 落点）：点击左栏块 → 切栏标记作废，栏区止于开栏标记；
  // 点击右栏块 → 切栏标记保留，栏区止于点击块
  const cutAt = r.col === 'l' ? r.openIdx : xi;
  // 保留栏区的左/右栏配对（结构）：左栏 = 开栏后…cutAt；右栏 = 切栏后…xi（仅点右栏时存在）
  const leftHas = anyBlock(r.openIdx + 1, cutAt);
  const rightHas = r.col === 'r' && anyBlock(r.switchIdx + 1, xi);
  // 保留区间（开栏后…点击块）无实际内容 → 整体拆除（两侧皆空占位不留空栏框线）
  const regionHasContent = anyReal(r.openIdx + 1, xi);
  const deleteIdx: number[] = [];
  if (r.endIdx >= 0) deleteIdx.push(r.endIdx);
  if (!leftHas || !rightHas || !regionHasContent) {
    // 拆除整个栏区：左右标记全清，被拆内容回单栏。开栏标记若还隐式收着
    // 【前一个】开放栏区（连续开栏无显式 colend 的自然形态），删掉它会让
    // 前栏区右栏吞掉本栏区全部内容——原位改插 colend 补上边界（拆除后
    // store 先降序删再按 insertAt 插，colend 恰落原开栏标记位置）
    let prevOpen = false;
    for (let i = 0; i < r.openIdx; i++) {
      const t = blocks[i].type;
      if (t === 'colmark') prevOpen = true;
      else if (t === 'colend') prevOpen = false;
    }
    deleteIdx.push(r.openIdx);
    if (r.switchIdx >= 0) deleteIdx.push(r.switchIdx);
    // 前栏区开放：原位插 colend 补边界（store 先降序删再插，colend 落原开栏位置）
    if (prevOpen) return { insertAt: r.openIdx, deleteIdx };
    return { insertAt: -1, deleteIdx };
  }
  // 配对保留：栏区止于点击块（点左栏时无配对可能，恒走拆除分支——此行仅点右栏可达）
  return { insertAt: xi, deleteIdx };
}
