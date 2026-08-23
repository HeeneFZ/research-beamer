// 排版规格引擎 v2 合约测试（BDD）：
//   固定字阶——全局标准 fontSize（默认 16pt PPT 等效）推导正文/页眉标题/页脚，
//   全 deck 每页一致（规矩/重复原则的最高优先级）；每页仅可用 fontScale(0.6–1.5) 调正文区；
//   密度调节只走「间距阶梯（行距/段距）+ 图片占位」，字号永不随内容量变化；
//   溢出兜底字号下限恒为 标准×60%（哪怕溢出也不再小）。

import { describe, it, expect, vi } from 'vitest';
import {
  computeLayoutSpec, spacingFor, defaultSpacing, layoutCssVars,
  FIT_MIN, PAGE_FONT_MIN, PAGE_FONT_MAX, IMG_H_MIN, IMG_H_MAX,
} from '../src/model/layoutSpec';
import { parseMarkdown, serializeMarkdown } from '../src/model/markdown';
import { Block, newId } from '../src/model/types';

const para = (text: string): Block => ({ id: newId(), type: 'paragraph', text });
const list = (items: string[]): Block => ({ id: newId(), type: 'itemize', items });
const eq = (latex: string): Block => ({ id: newId(), type: 'equation', latex });
const fig = (caption?: string): Block => ({ id: newId(), type: 'figure', src: 'media/a.png', caption });
const tbl = (rows: number, caption?: string): Block => ({
  id: newId(), type: 'table', caption,
  cells: Array.from({ length: rows }, () => ['甲', '乙']),
});

const PPT2PHYS = 160 / 254;

describe('固定字阶（全 deck 统一）', () => {
  it('Given 内容量截然不同的两页 When 分别计算规格 Then 字号体系完全一致（页面间不割裂）', () => {
    const sparse = computeLayoutSpec({ blocks: [para('结论。')] });
    const dense = computeLayoutSpec({
      blocks: [para('密'.repeat(300)), list(Array.from({ length: 8 }, () => '条目'.repeat(12))), eq('x'.repeat(150)), tbl(8), fig('甲'), fig('乙')],
    });
    expect(dense.bodyPt).toBeCloseTo(sparse.bodyPt, 8);
    expect(dense.titlePt).toBeCloseTo(sparse.titlePt, 8);
    expect(dense.footPt).toBeCloseTo(sparse.footPt, 8);
    expect(dense.capEm).toBeCloseTo(sparse.capEm, 8);
    expect(dense.lhNom).toBe(sparse.lhNom);
    expect(dense.paraGapNom).toBe(sparse.paraGapNom);
  });

  it('默认标准 16pt：正文物理=16×160/254、页眉标题=×4/3、页脚=×2/3、题注 em 比=0.75', () => {
    const s = computeLayoutSpec({ blocks: [] });
    expect(s.bodyPt).toBeCloseTo(16 * PPT2PHYS, 6);
    expect(s.titlePt).toBeCloseTo(16 * (4 / 3) * PPT2PHYS, 6);
    expect(s.footPt).toBeCloseTo(16 * (2 / 3) * PPT2PHYS, 6);
    expect(s.capEm).toBeCloseTo(0.75, 6);
  });

  it('Given 全局 fontSize=20 When 计算规格 Then 字阶整体等比放大', () => {
    const s = computeLayoutSpec({ blocks: [], fontSize: 20 });
    expect(s.bodyPt).toBeCloseTo(20 * PPT2PHYS, 6);
    expect(s.titlePt).toBeCloseTo(20 * (4 / 3) * PPT2PHYS, 6);
  });
});

describe('每页 fontScale（正文区 60%–150%）', () => {
  it('fontScale=1.5 → 正文 ×1.5；字号下限 fitMin = 0.6/1.5 = 0.4', () => {
    const s = computeLayoutSpec({ blocks: [], fontScale: 1.5 });
    expect(s.bodyPt).toBeCloseTo(16 * PPT2PHYS * 1.5, 6);
    expect(s.fitMin).toBeCloseTo(FIT_MIN / 1.5, 6);
  });

  it('fontScale=0.6 → fitMin=1（该页字号永不再压）', () => {
    const s = computeLayoutSpec({ blocks: [], fontScale: 0.6 });
    expect(s.fitMin).toBeCloseTo(1, 6);
  });

  it('fontScale 越界钳到 [0.6, 1.5]', () => {
    expect(computeLayoutSpec({ blocks: [], fontScale: 3 }).bodyPt)
      .toBeCloseTo(16 * PPT2PHYS * PAGE_FONT_MAX, 6);
    expect(computeLayoutSpec({ blocks: [], fontScale: 0.1 }).bodyPt)
      .toBeCloseTo(16 * PPT2PHYS * PAGE_FONT_MIN, 6);
  });

  it('fontScale 不影响页眉标题与页脚（页级调节只作用正文区）', () => {
    const a = computeLayoutSpec({ blocks: [], fontScale: 1 });
    const b = computeLayoutSpec({ blocks: [], fontScale: 1.5 });
    expect(b.titlePt).toBeCloseTo(a.titlePt, 8);
    expect(b.footPt).toBeCloseTo(a.footPt, 8);
  });
});

describe('间距阶梯 spacingFor（密度只压间距，不压字号）', () => {
  const spec = computeLayoutSpec({ blocks: [] });
  it('s=0 取宽松端：行高 1.5 / 统一段距 1.2em / 项距 0.7em', () => {
    const sp = spacingFor(spec, 0);
    expect(sp.lh).toBeCloseTo(1.5, 6);
    expect(sp.paraGap).toBeCloseTo(1.2, 6);
    expect(sp.itemGap).toBeCloseTo(0.7, 6);
  });
  it('s=1 取紧凑端：1.2 / 0.6 / 0.4；s=0.5 居中且单调', () => {
    const sp = spacingFor(spec, 1);
    expect(sp.lh).toBeCloseTo(1.2, 6);
    expect(sp.paraGap).toBeCloseTo(0.6, 6);
    expect(sp.itemGap).toBeCloseTo(0.4, 6);
    const mid = spacingFor(spec, 0.5);
    expect(mid.lh).toBeGreaterThan(1.2);
    expect(mid.lh).toBeLessThan(1.5);
  });
});

describe('图限高起点（第廿九轮：宽度权威，实测适配，不做估算预压）', () => {
  it('imgHNom 恒为 IMG_H_MAX：有图/无图/文多/文少/双栏皆不预压', () => {
    const colmark = (): Block => ({ id: newId(), type: 'colmark' });
    const colend = (): Block => ({ id: newId(), type: 'colend' });
    expect(computeLayoutSpec({ blocks: [para('纯文本')] }).imgHNom).toBe(IMG_H_MAX);
    expect(computeLayoutSpec({ blocks: [para('短'), fig('甲'), fig('乙')] }).imgHNom).toBe(IMG_H_MAX);
    expect(
      computeLayoutSpec({
        blocks: [para('长'.repeat(300)), list(Array.from({ length: 6 }, () => '项'.repeat(20))), fig('甲'), fig('乙')],
      }).imgHNom,
    ).toBe(IMG_H_MAX);
    expect(
      computeLayoutSpec({
        blocks: [colmark(), para('左栏'.repeat(60)), colmark(), fig('甲'), colend(), para('下接'.repeat(200))],
      }).imgHNom,
    ).toBe(IMG_H_MAX);
  });
});

describe('layoutCssVars 与 defaultSpacing', () => {
  it('输出带单位的 CSS 变量；标称态 s=0/imgH=imgHNom/fit=1', () => {
    const spec = computeLayoutSpec({ blocks: [para('变量检查'), fig('甲')] });
    const st = defaultSpacing(spec);
    expect(st).toEqual({ s: 0, imgH: spec.imgHNom, fit: 1 });
    const vars = layoutCssVars(spec, st);
    expect(vars['--fs-body']).toBe(`${spec.bodyPt.toFixed(2)}pt`);
    expect(vars['--fs-title']).toBe(`${spec.titlePt.toFixed(2)}pt`);
    expect(vars['--lh']).toBe('1.50');
    expect(vars['--gap-para']).toBe('1.20em');
    expect(vars['--gap-block']).toBeUndefined(); // 块距通道已并入统一段距（间距单一约定）
    expect(vars['--img-max-h']).toBe(`${spec.imgHNom.toFixed(1)}cqh`);
    expect(vars['--body-fit']).toBe('1');
    const compact = layoutCssVars(spec, { s: 1, imgH: IMG_H_MIN, fit: 0.6 });
    expect(compact['--lh']).toBe('1.20');
    expect(compact['--img-max-h']).toBe(`${IMG_H_MIN.toFixed(1)}cqh`);
    expect(compact['--body-fit']).toBe('0.6');
  });
});

describe('store.pageLayout（内存态排版结果，全模式共享）', () => {
  it('setPageLayout 存取 / 载入工程后清空', async () => {
    const { useStore } = await import('../src/state/store');
    const st = () => useStore.getState();
    st().setPageLayout('s1|16:9', { s: 0.5, imgH: 30, fit: 0.9 });
    expect(st().pageLayout['s1|16:9']).toMatchObject({ s: 0.5, fit: 0.9 });
    st().loadProjectData({ md: '---\nbeamerapp: 1\n---\n\n:::: slide\n::::\n', folder: '/tmp/z' });
    expect(Object.keys(st().pageLayout)).toHaveLength(0);
  });

  it('跳转高亮一次性：jumpToRef 置位、离开目标页即失效（防返回重放）', async () => {
    const { useStore } = await import('../src/state/store');
    const st = () => useStore.getState();
    st().loadProjectData({
      md: '---\nbeamerapp: 1\n---\n\n:::: slide\n$$\nx=1 \\label{eq:a}\n$$\n::::\n\n:::: slide\n参照\n::::\n',
      folder: '/tmp/g',
    });
    st().gotoPage(1);
    st().jumpToRef('eq:a');
    expect(st().flash?.page).toBe(0);
    st().gotoPage(1);
    expect(st().flash).toBeNull();
  });

  it('undo/redo 的 current 钳制不为负（空 deck 安全）', async () => {
    const { useStore } = await import('../src/state/store');
    const st = () => useStore.getState();
    st().loadProjectData({ md: '---\nbeamerapp: 1\n---\n', folder: '/tmp/e' });
    expect(st().computed.pages).toHaveLength(0);
    st().undo();
    expect(st().current).toBe(0);
  });

  it('moveTargetOf：栏内调序给目标位；跨栏段/位置未变返回 null（按钮须 disable 而非静默失效）', async () => {
    const { moveTargetOf } = await import('../src/state/store');
    const { newId: nid } = await import('../src/model/types');
    const p = (id?: string): Block => ({ id: id ?? nid(), type: 'paragraph', text: 'x' });
    const colmark = (): Block => ({ id: nid(), type: 'colmark' });
    const colend = (): Block => ({ id: nid(), type: 'colend' });
    // 单栏：[p1 p2 p3]
    const p1 = p('p1'), p2 = p('p2'), p3 = p('p3');
    const flat = [p1, p2, p3];
    expect(moveTargetOf(flat, 'p3', 'p1')).toBe(0);   // p3 提到最前
    expect(moveTargetOf(flat, 'p1', 'p3')).toBe(1);   // p1 移到 p3 前（=p2 后）
    expect(moveTargetOf(flat, 'p1', 'p2')).toBeNull(); // 位置未变
    // 双栏：[pA |col| pL |col| pR |/col| pB pC]
    const pA = p('pA'), pL = p('pL'), pR = p('pR'), pB = p('pB'), pC = p('pC');
    const twoCol = [pA, colmark(), pL, colmark(), pR, colend(), pB, pC];
    expect(moveTargetOf(twoCol, 'pR', 'pL')).toBeNull();  // 跨栏不支持
    expect(moveTargetOf(twoCol, 'pL', null)).toBeNull();  // 栏内仅一块，位置未变
    expect(moveTargetOf(twoCol, 'pB', 'pA')).toBeNull();  // 栏外但跨段（pA 在前段）也不支持
    expect(moveTargetOf(twoCol, 'pC', 'pB')).toBe(6);     // 同段内正常调序
  });
});

describe('复制页剥除交叉引用标签（第廿二轮修复）', () => {
  const MD = '---\nbeamerapp: 1\n---\n\n:::: slide\n::: figure src="media/a.png" label="fig:x" caption="原图"\n:::\n::::\n\n:::: slide\n正文\n::::\n';
  it('duplicateSlide 副本块不带走 label：label 全 deck 唯一，[@fig:x] 仍指向原块', async () => {
    const { useStore } = await import('../src/state/store');
    const st = () => useStore.getState();
    st().loadProjectData({ md: MD, folder: '/tmp/dup' });
    const sl = st().deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad');
    st().duplicateSlide(sl.slide.id);
    const labeled: string[] = [];
    for (const it of st().deck.items) {
      if (it.kind === 'slide') for (const b of it.slide.blocks) if (b.label) labeled.push(b.label);
    }
    expect(labeled).toEqual(['fig:x']); // 修复前为 ['fig:x','fig:x']（后者覆盖前者的编号/跳转索引）
    expect(st().computed.labelPageIndex.get('fig:x')).toBe(0);
  });
});

describe('撤销/重做与防抖快照（第廿一轮修复：500ms 窗口竞态）', () => {
  const MD = '---\nbeamerapp: 1\n---\n\n:::: slide\n甲\n::::\n';

  it('变更后 500ms 内撤销回退到变更前一刻（不跳两步），重做不丢', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await import('../src/state/store');
      const st = () => useStore.getState();
      st().loadProjectData({ md: MD, folder: '/tmp/h1' });
      const sl = st().deck.items[0];
      if (sl.kind !== 'slide') throw new Error('bad');
      const bid = sl.slide.blocks[0].id;
      const text = () => {
        const it = st().deck.items[0];
        return it.kind === 'slide' ? it.slide.blocks[0].text : '?';
      };
      st().updateBlock(sl.slide.id, bid, { text: '乙' });
      st().updateBlock(sl.slide.id, bid, { text: '丙' }); // 防抖窗口内连续两次变更
      st().undo(); // 挂起快照须先同步落栈，否则弹出更早快照（实测曾回跳到「甲」）
      expect(text()).toBe('乙');
      st().redo(); // 挂起快照落栈不得清掉刚压入的重做
      expect(text()).toBe('丙');
    } finally {
      vi.useRealTimers();
    }
  });

  it('新编辑立即作废旧重做栈（不等防抖落栈；快照去重不跳过清理）', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await import('../src/state/store');
      const st = () => useStore.getState();
      st().loadProjectData({ md: MD, folder: '/tmp/h2' });
      const sl = st().deck.items[0];
      if (sl.kind !== 'slide') throw new Error('bad');
      const bid = sl.slide.blocks[0].id;
      const text = () => {
        const it = st().deck.items[0];
        return it.kind === 'slide' ? it.slide.blocks[0].text : '?';
      };
      st().updateBlock(sl.slide.id, bid, { text: '乙' });
      vi.advanceTimersByTime(600); // 落栈
      st().undo(); // 回「甲」，redo=[乙]
      st().updateBlock(sl.slide.id, bid, { text: '丙' }); // 新编辑：redo 立即失效
      st().redo(); // 应无快照可重做
      expect(text()).toBe('丙');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('md 合约：fontSize 与 fontScale', () => {
  const MD = `---
beamerapp: 1
title: 字号合约
fontSize: 20
---

:::: slide title="大字页" fontScale="1.25"
正文
::::
`;
  it('解析 front-matter fontSize 与页属性 fontScale', () => {
    const deck = parseMarkdown(MD);
    expect(deck.config.fontSize).toBe(20);
    const sl = deck.items[0];
    expect(sl.kind === 'slide' && sl.slide.fontScale).toBeCloseTo(1.25);
  });
  it('序列化往返幂等', () => {
    const md1 = serializeMarkdown(parseMarkdown(MD));
    expect(md1).toBe(serializeMarkdown(parseMarkdown(md1)));
    expect(md1).toContain('fontScale="1.25"');
    expect(md1).toContain('fontSize: 20');
  });
  it('缺省 fontSize → 16；fontScale 越界钳 0.6–1.5', () => {
    const deck = parseMarkdown('---\nbeamerapp: 1\n---\n\n:::: slide fontScale="3"\nx\n::::\n');
    expect(deck.config.fontSize).toBe(16);
    const sl = deck.items[0];
    expect(sl.kind === 'slide' && sl.slide.fontScale).toBe(1.5);
  });
});


describe('md 合约：出现顺序（段落 {order=N} / 列表逐项与块级）', () => {
  it('段落末行尾 {order=2} → block.order=2 且文本剥离标记；往返幂等', () => {
    const deck = parseMarkdown('---\nbeamerapp: 1\n---\n\n:::: slide\n先说结论 {order=2}\n\n普通段落\n::::\n');
    const sl = deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad parse');
    expect(sl.slide.blocks[0]).toMatchObject({ type: 'paragraph', text: '先说结论', order: 2 });
    expect(sl.slide.blocks[1]).toMatchObject({ type: 'paragraph', text: '普通段落' });
    expect(sl.slide.blocks[1].order).toBeUndefined();
    const md1 = serializeMarkdown(deck);
    expect(md1).toContain('先说结论 {order=2}');
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });

  it('硬换行段落（行尾反斜杠）与 order 共存：标记在最末行之后', () => {
    const deck = parseMarkdown('---\nbeamerapp: 1\n---\n\n:::: slide\n第一行\\\n第二行 {order=3}\n::::\n');
    const sl = deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad parse');
    expect(sl.slide.blocks[0]).toMatchObject({ type: 'paragraph', text: '第一行\n第二行', order: 3 });
    const md1 = serializeMarkdown(deck);
    expect(md1).toContain('第一行\\');
    expect(md1).toContain('第二行 {order=3}');
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });

  it('列表逐项 {order=N} 与块级独立行；无标记项为 undefined；往返幂等', () => {
    const MD2 = '---\nbeamerapp: 1\n---\n\n:::: slide\n- 甲 {order=2}\n- 乙\n- 丙 {order=3}\n{order=1}\n::::\n';
    const deck = parseMarkdown(MD2);
    const sl = deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad parse');
    expect(sl.slide.blocks[0]).toMatchObject({ type: 'itemize', items: ['甲', '乙', '丙'], order: 1, itemOrders: [2, undefined, 3] });
    const md1 = serializeMarkdown(deck);
    expect(md1).toContain('- 甲 {order=2}');
    expect(md1).toContain('- 乙\n');
    expect(md1).toContain('{order=1}');
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });

  it('pageOrders 汇总块级与列表逐项顺序（去重升序）', async () => {
    const { pageOrders } = await import('../src/state/store');
    expect(pageOrders({
      kind: 'slide',
      slide: { blocks: [
        { order: 3 },
        { itemOrders: [2, undefined, 1] },
        {},
      ] },
    } as never)).toEqual([1, 2, 3]);
  });

  it('updateBlock 改 items 后 itemOrders 按下标对齐（截断/补位/全空归一）', async () => {
    const { useStore } = await import('../src/state/store');
    const st = () => useStore.getState();
    st().loadProjectData({ md: '---\nbeamerapp: 1\n---\n\n:::: slide\n- 甲 {order=2}\n- 乙\n- 丙 {order=3}\n::::\n', folder: '/tmp/z' });
    const sl = st().deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad');
    const bid = sl.slide.blocks[0].id;
    // 删到只剩两项 → 截断（JSON 快照路径空位为 null，内存路径为 undefined，判空一律 ?? 归一）
    const norm = (b: Block) => (b.itemOrders || []).map((o) => o ?? null);
    st().updateBlock(sl.slide.id, bid, { items: ['甲', '乙'] });
    let b = (st().deck.items[0] as typeof sl).slide.blocks[0];
    expect(norm(b)).toEqual([2, null]);
    // 增项 → 补空位
    st().updateBlock(sl.slide.id, bid, { items: ['甲', '乙', '新', '增'] });
    b = (st().deck.items[0] as typeof sl).slide.blocks[0];
    expect(norm(b)).toEqual([2, null, null, null]);
  });
  it('itemOrders 前后缀对齐：删首项 / 中部插入不整体错位（第卅二轮审查修复）', async () => {
    const { useStore } = await import('../src/state/store');
    const st = () => useStore.getState();
    st().loadProjectData({ md: '---\nbeamerapp: 1\n---\n\n:::: slide\n- 甲\n- 乙 {order=2}\n- 丙 {order=3}\n::::\n', folder: '/tmp/z' });
    const sl = st().deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad');
    const bid = sl.slide.blocks[0].id;
    const norm = (b: Block) => (b.itemOrders || []).map((o) => o ?? null);
    // 删首项：乙保住 2、丙保住 3（旧按下标对齐会得 [null,2]）
    st().updateBlock(sl.slide.id, bid, { items: ['乙', '丙'] });
    let b = (st().deck.items[0] as typeof sl).slide.blocks[0];
    expect(norm(b)).toEqual([2, 3]);
    // 中部插入：新项无顺序、两侧原样保留
    st().updateBlock(sl.slide.id, bid, { items: ['乙', '新', '丙'] });
    b = (st().deck.items[0] as typeof sl).slide.blocks[0];
    expect(norm(b)).toEqual([2, null, 3]);
  });
});

describe('配色 preset 保留（切回 blue 的回归根因）', () => {
  it('setConfig 应用预设后 preset 字段入 md 且往返幂等', async () => {
    const { useStore } = await import('../src/state/store');
    const { PRESETS } = await import('../src/model/palette');
    const st = () => useStore.getState();
    st().loadProjectData({ md: '---\nbeamerapp: 1\n---\n\n:::: slide\nx\n::::\n', folder: '/tmp/z' });
    st().setConfig({ palette: { ...PRESETS['forest-green'], preset: 'forest-green' } });
    expect(st().deck.config.palette.preset).toBe('forest-green');
    expect(st().deck.config.palette.primary.base).toBe('#1D7A4F');
    const md = serializeMarkdown(st().deck);
    expect(md).toContain('forest-green');
    const back = parseMarkdown(md);
    expect(back.config.palette.preset).toBe('forest-green');
    // 再切回 blue：preset 跟随、颜色回到蓝色系
    st().setConfig({ palette: { ...PRESETS['academic-blue'], preset: 'academic-blue' } });
    expect(st().deck.config.palette.preset).toBe('academic-blue');
    expect(st().deck.config.palette.primary.base).toBe('#0F66AD');
  });
});
