// 排版规格引擎 v2 合约测试（BDD）：
//   固定字阶——全局标准 fontSize（默认 16pt PPT 等效）推导正文/页眉标题/页脚，
//   全 deck 每页一致（规矩/重复原则的最高优先级）；每页仅可用 fontScale(0.6–1.5) 调正文区；
//   密度调节只走「间距阶梯（行距/段距）+ 图片占位」，字号永不随内容量变化；
//   溢出兜底字号下限恒为 标准×60%（哪怕溢出也不再小）。

import { describe, it, expect, vi } from 'vitest';
import {
  computeLayoutSpec, spacingFor, defaultSpacing, layoutCssVars,
  FIT_MIN, PAGE_FONT_MIN, PAGE_FONT_MAX, IMG_H_MIN, IMG_H_MAX, IMG_H_MAX_IMGONLY,
  compressBest, FIT_TOL, OverflowProbe,
} from '../src/model/layoutSpec';
import { useStore } from '../src/state/store';
import { parseMarkdown, serializeMarkdown } from '../src/model/markdown';
import { Block, newId } from '../src/model/types';
import { colRegionAt, colEndPlan, buildSegments } from '../src/model/segments';

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
  const colmark = (): Block => ({ id: newId(), type: 'colmark' });
  const colend = (): Block => ({ id: newId(), type: 'colend' });
  it('含任何文本/公式/表格内容的页 imgHNom 恒为 IMG_H_MAX（不预压）', () => {
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
  it('纯图页 imgHNom = IMG_H_MAX_IMGONLY（55 天花板钳制 aspect≈1.5 的图为半宽的修复）', () => {
    expect(computeLayoutSpec({ blocks: [fig('甲')] }).imgHNom).toBe(IMG_H_MAX_IMGONLY);
    expect(computeLayoutSpec({ blocks: [fig('甲'), fig('乙'), fig('丙')] }).imgHNom).toBe(IMG_H_MAX_IMGONLY);
    // 栏标记不算内容：colmark/colend 包裹的纯图区仍按纯图页
    expect(computeLayoutSpec({ blocks: [colmark(), fig('甲'), colmark(), fig('乙'), colend()] }).imgHNom).toBe(IMG_H_MAX_IMGONLY);
    // 视频块同属媒体：纯视频页也是纯图页
    expect(computeLayoutSpec({ blocks: [{ id: newId(), type: 'video', src: 'media/v.mp4' }] }).imgHNom).toBe(IMG_H_MAX_IMGONLY);
    // 空块列表（无内容）不算纯图页
    expect(computeLayoutSpec({ blocks: [] }).imgHNom).toBe(IMG_H_MAX);
    expect(computeLayoutSpec({ blocks: [colmark(), colend()] }).imgHNom).toBe(IMG_H_MAX);
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

describe('colRegionAt / colEndPlan（结束双栏区语义，与开始双栏区对称）', () => {
  it('colRegionAt：栏内块归属（左/右栏、开/切/收标记位）；栏外与孤立标记返回 null/忽略', () => {
    const p = (id: string): Block => ({ id, type: 'paragraph', text: 'x' });
    const mark = (): Block => ({ id: newId(), type: 'colmark' });
    const end = (): Block => ({ id: newId(), type: 'colend' });
    const m1 = mark(), m2 = mark(), e1 = end();
    const blocks = [p('pA'), m1, p('pL'), m2, p('pR1'), p('pR2'), e1, p('pB')];
    expect(colRegionAt(blocks, 'pL')).toEqual({ col: 'l', openIdx: 1, switchIdx: 3, endIdx: 6, lastIdx: 5 });
    expect(colRegionAt(blocks, 'pR2')).toEqual({ col: 'r', openIdx: 1, switchIdx: 3, endIdx: 6, lastIdx: 5 });
    expect(colRegionAt(blocks, 'pA')).toBeNull();   // 栏外
    expect(colRegionAt(blocks, 'pB')).toBeNull();   // 收栏后
    // 页尾未收栏：endIdx = -1
    const open = [p('pA'), m1, p('pL'), m2, p('pR')];
    expect(colRegionAt(open, 'pR')?.endIdx).toBe(-1);
    expect(colRegionAt(open, 'pR')?.lastIdx).toBe(4);
    // 孤立 colend（无开栏）忽略
    const orphan = [p('pA'), end(), p('pB')];
    expect(colRegionAt(orphan, 'pA')).toBeNull();
  });

  it('colEndPlan：右栏首块收栏——左右无法配对，整个栏区拆除回单栏', () => {
    const p = (id: string): Block => ({ id, type: 'paragraph', text: 'x' });
    const mark = (): Block => ({ id: newId(), type: 'colmark' });
    const end = (): Block => ({ id: newId(), type: 'colend' });
    const m1 = mark(), m2 = mark(), e1 = end();
    // [pA m1 pL m2 pR1 pR2 e1 pB]，点击 pR1：保留左栏 pL 但右栏空 → 拆除
    const blocks = [p('pA'), m1, p('pL'), m2, p('pR1'), p('pR2'), e1, p('pB')];
    expect(colEndPlan(blocks, 'pR1')).toEqual({ insertAt: -1, deleteIdx: [6, 1, 3] });
  });

  it('colEndPlan：栏尾最后一块收栏——colend 紧贴其后（非哑操作，后续插入落单栏）', () => {
    const p = (id: string): Block => ({ id, type: 'paragraph', text: 'x' });
    const mark = (): Block => ({ id: newId(), type: 'colmark' });
    const m1 = mark(), m2 = mark();
    // [m1 pL m2 pR1 pR2]（页尾无显式收栏），点击 pR2
    const blocks = [p('pA'), m1, p('pL'), m2, p('pR1'), p('pR2')];
    expect(colEndPlan(blocks, 'pR2')).toEqual({ insertAt: 5, deleteIdx: [] });
  });

  it('colEndPlan：右栏中段收栏——栏区保留至切栏点，点击块及其后并回单栏', () => {
    const p = (id: string): Block => ({ id, type: 'paragraph', text: 'x' });
    const mark = (): Block => ({ id: newId(), type: 'colmark' });
    const m1 = mark(), m2 = mark();
    // [m1 pL m2 pR1 pR2 pB]，点击 pR2：pL|pR1 配对保留，pR2/pB 单栏
    const blocks = [m1, p('pL'), m2, p('pR1'), p('pR2'), p('pB')];
    expect(colEndPlan(blocks, 'pR2')).toEqual({ insertAt: 4, deleteIdx: [] });
  });

  it('colEndPlan：左栏点击——右栏内容并入其后单栏流，栏区整体拆除（防分裂损坏）', () => {
    const p = (id: string): Block => ({ id, type: 'paragraph', text: 'x' });
    const mark = (): Block => ({ id: newId(), type: 'colmark' });
    const end = (): Block => ({ id: newId(), type: 'colend' });
    const m1 = mark(), m2 = mark(), e1 = end();
    // [pA m1 pL m2 pR e1 pB]，点击 pL：切栏后右栏无从配对 → 全部回单栏
    const blocks = [p('pA'), m1, p('pL'), m2, p('pR'), e1, p('pB')];
    expect(colEndPlan(blocks, 'pL')).toEqual({ insertAt: -1, deleteIdx: [5, 1, 3] });
  });

  it('colEndPlan：栏区被收空（左右皆无保留内容）——开栏标记也删，无需插入', () => {
    const p = (id: string): Block => ({ id, type: 'paragraph', text: 'x' });
    const mark = (): Block => ({ id: newId(), type: 'colmark' });
    const m1 = mark(), m2 = mark();
    // [pA m1 pL m2 pB]：左栏仅 pL（点击块），右栏空 → 整个栏区拆除
    const blocks = [p('pA'), m1, p('pL'), m2, p('pB')];
    expect(colEndPlan(blocks, 'pL')).toEqual({ insertAt: -1, deleteIdx: [1, 3] });
  });
});

describe('insertColRegion / insertColEnd（store 动作，段结构不损坏）', () => {
  const MD = (inner: string) => `---\nbeamerapp: 1\n---\n\n:::: slide\n${inner}\n::::\n`;
  const segsOf = async (inner: string) => {
    const { useStore } = await import('../src/state/store');
    const { buildSegments } = await import('../src/model/segments');
    const st = () => useStore.getState();
    st().loadProjectData({ md: MD(inner), folder: '/tmp/col' });
    // mutate 每次整体替换 deck 对象——段结构必须从 store 即时态重读，闭包持引用必陈旧
    const blocksNow = () => {
      const it = st().deck.items[0];
      return it && it.kind === 'slide' ? it.slide.blocks : [];
    };
    const sl = st().deck.items[0];
    if (!sl || sl.kind !== 'slide') throw new Error('bad');
    return { st, slide: sl.slide, segs: () => buildSegments(blocksNow()) };
  };

  it('栏内块上开新栏区：让位到栏区终结处，原栏区结构不损坏', async () => {
    // [colmark pL colmark pR colend pX]，在 pR 上开新栏区
    const { st, slide, segs } = await segsOf('::: col\n左\n\n::: col\n右\n\n::: /col\n\n尾\n');
    const pR = slide.blocks.find((b) => b.type === 'paragraph' && b.text === '右')!;
    st().insertColRegion(slide.id, pR.id);
    // 期望：原栏区(左|右) + 新栏区(N左|N右) + 单栏尾——原 colend 改收新栏区，尾不动
    const s = segs();
    expect(s).toHaveLength(3);
    expect(s[0].kind).toBe('cols');
    if (s[0].kind === 'cols') {
      expect(s[0].left.map((b) => b.text)).toEqual(['左']);
      expect(s[0].right.map((b) => b.text)).toEqual(['右']);
    }
    expect(s[1].kind).toBe('cols');
    if (s[1].kind === 'cols') {
      expect(s[1].left.map((b) => b.text)).toEqual(['']);
      expect(s[1].right.map((b) => b.text)).toEqual(['']);
    }
    expect(s[2].kind).toBe('full');
    if (s[2].kind === 'full') expect(s[2].blocks.map((b) => b.text)).toEqual(['尾']);
  });

  it('右栏空栏（退化区）上开新栏区：越过切栏标记，不把新组吸进旧栏右栏', async () => {
    // [colmark pL colmark]（切栏标记后无内容），在 pL 上开新栏区
    const { st, slide, segs } = await segsOf('::: col\n左\n\n::: col\n');
    const pL = slide.blocks.find((b) => b.type === 'paragraph')!;
    st().insertColRegion(slide.id, pL.id);
    const s = segs();
    // 旧退化栏区（左|空）保持原状，新栏区在其后自成一体
    expect(s).toHaveLength(2);
    expect(s[0].kind).toBe('cols');
    if (s[0].kind === 'cols') {
      expect(s[0].left.map((b) => b.text)).toEqual(['左']);
      expect(s[0].right).toHaveLength(0);
    }
    expect(s[1].kind).toBe('cols');
    if (s[1].kind === 'cols') {
      expect(s[1].left.map((b) => b.text)).toEqual(['']);
      expect(s[1].right.map((b) => b.text)).toEqual(['']);
    }
  });

  it('insertColEnd：右栏首块收栏——左右无从配对，整个栏区拆除回单栏', async () => {
    // [colmark pL colmark pR1 pR2 pX]（页尾无收栏），在 pR1 上收栏
    const { st, slide, segs } = await segsOf('::: col\n左\n\n::: col\n右一\n\n右二\n\n尾\n');
    const pR1 = slide.blocks.find((b) => b.type === 'paragraph' && b.text === '右一')!;
    st().insertColEnd(slide.id, pR1.id);
    const s = segs();
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('full');
    if (s[0].kind === 'full') expect(s[0].blocks.map((b) => b.text)).toEqual(['左', '右一', '右二', '尾']);
  });

  it('insertColEnd：右栏中段收栏——前段配对保留，点击块起并回单栏', async () => {
    // [colmark pL colmark pR1 pR2 pX]，在 pR2 上收栏：保留 [左|右一]，右二/尾回单栏
    const { st, slide, segs } = await segsOf('::: col\n左\n\n::: col\n右一\n\n右二\n\n尾\n');
    const pR2 = slide.blocks.find((b) => b.type === 'paragraph' && b.text === '右二')!;
    st().insertColEnd(slide.id, pR2.id);
    const s = segs();
    expect(s).toHaveLength(2);
    expect(s[0].kind).toBe('cols');
    if (s[0].kind === 'cols') {
      expect(s[0].left.map((b) => b.text)).toEqual(['左']);
      expect(s[0].right.map((b) => b.text)).toEqual(['右一']);
    }
    expect(s[1].kind).toBe('full');
    if (s[1].kind === 'full') expect(s[1].blocks.map((b) => b.text)).toEqual(['右二', '尾']);
  });

  it('md 往返：colend 落点/栏区结构序列化幂等', async () => {
    const { useStore } = await import('../src/state/store');
    const { serializeMarkdown, parseMarkdown } = await import('../src/model/markdown');
    const st = () => useStore.getState();
    const inner = '::: col\n左\n\n::: col\n右一\n\n右二\n\n尾\n';
    st().loadProjectData({ md: MD(inner), folder: '/tmp/col' });
    const sl = st().deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad');
    const pR1 = sl.slide.blocks.find((b) => b.type === 'paragraph' && b.text === '右一')!;
    st().insertColEnd(sl.slide.id, pR1.id);
    const md1 = serializeMarkdown(st().deck);
    // 二次解析 + 序列化 = 幂等
    const d2 = parseMarkdown(md1);
    expect(serializeMarkdown(d2)).toBe(md1);
  });
});

describe('第卅八轮：空栏区收回 / 块复制粘贴 / 撤销栈上限', () => {
  const MD = (inner: string) => `---\nbeamerapp: 1\n---\n\n:::: slide\n${inner}\n::::\n`;

  it('buildSegments：空栏区（删光内容）不产出段——分割线与栏容器不再残留', () => {
    const p = (id: string): Block => ({ id, type: 'paragraph', text: 'x' });
    const mark = (): Block => ({ id: newId(), type: 'colmark' });
    const end = (): Block => ({ id: newId(), type: 'colend' });
    // 仅标记（内容删光）→ 无段
    expect(buildSegments([mark(), mark(), end()])).toHaveLength(0);
    // 前后单栏 + 中间空栏区 → 空栏区消失，前后各成单栏段（块序不变）
    const segs = buildSegments([p('pA'), mark(), mark(), end(), p('pB')]);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.kind === 'full')).toBe(true);
    // 单边有内容的栏区仍正常产出
    expect(buildSegments([mark(), p('pL'), mark(), end()])).toHaveLength(1);
  });

  it('deleteBlock：删光栏内最后一块自动收回空栏区（数据源清除，md 不残留标记）', async () => {
    const { useStore } = await import('../src/state/store');
    const { serializeMarkdown } = await import('../src/model/markdown');
    const st = () => useStore.getState();
    st().loadProjectData({ md: MD('::: col\n左\n\n::: col\n右\n\n::: /col\n\n尾\n'), folder: '/tmp/col' });
    const sl = st().deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad');
    // 删左栏块（右栏还有）：栏区保留
    const pL = sl.slide.blocks.find((b) => b.type === 'paragraph' && b.text === '左')!;
    st().deleteBlock(sl.slide.id, pL.id);
    let now = (() => { const it = st().deck.items[0]; return it && it.kind === 'slide' ? it.slide : null; })()!;
    expect(now.blocks.some((b) => b.type === 'colmark')).toBe(true);
    // 删右栏块：栏区清空 → 标记全部收回
    const pR = now.blocks.find((b) => b.type === 'paragraph' && b.text === '右')!;
    st().deleteBlock(sl.slide.id, pR.id);
    now = (() => { const it = st().deck.items[0]; return it && it.kind === 'slide' ? it.slide : null; })()!;
    expect(now.blocks.filter((b) => b.type !== 'colmark' && b.type !== 'colend').map((b) => b.text)).toEqual(['尾']);
    expect(now.blocks.some((b) => b.type === 'colmark' || b.type === 'colend')).toBe(false);
    // md 序列化无栏标记残留
    expect(serializeMarkdown(st().deck)).not.toMatch(/::: (\/)?col/);
  });

  it('copyBlock/pasteBlockAfter：复制粘贴块（label/pos 剥除、新 id、落在锚点后）', async () => {
    const { useStore } = await import('../src/state/store');
    const st = () => useStore.getState();
    st().loadProjectData({ md: MD('首段\n\n::: equation label="eq:a"\nx=1\n:::\n'), folder: '/tmp/col' });
    const sl = st().deck.items[0];
    if (sl.kind !== 'slide') throw new Error('bad');
    const eq = sl.slide.blocks.find((b) => b.type === 'equation')!;
    const p0 = sl.slide.blocks.find((b) => b.type === 'paragraph')!;
    st().copyBlock(sl.slide.id, eq.id);
    expect(st().clipBlock?.label).toBe('eq:a');
    const newId = st().pasteBlockAfter(sl.slide.id, p0.id);
    expect(newId).toBeTruthy();
    const now = (() => { const it = st().deck.items[0]; return it && it.kind === 'slide' ? it.slide : null; })()!;
    expect(now.blocks.map((b) => b.type)).toEqual(['paragraph', 'equation', 'equation']);
    // 副本：新 id、label 剥除（全 deck 唯一，防引用劫持）
    const copy = now.blocks.find((b) => b.id === newId)!;
    expect(copy).toBeTruthy();
    expect(copy.id).not.toBe(eq.id);
    expect(copy.label).toBeUndefined();
    expect(copy.latex).toBe('x=1');
    // 剪贴板空时粘贴返回 null
    useStore.setState({ clipBlock: null });
    expect(st().pasteBlockAfter(sl.slide.id, p0.id)).toBeNull();
  });

  it('撤销栈上限 100：超限丢最旧（historyDepth 恒 ≤100）', async () => {
    const { recordHistory, historyDepth, clearHistory } = await import('../src/state/history');
    clearHistory();
    for (let i = 0; i < 130; i++) recordHistory({ config: { i } } as never, false);
    expect(historyDepth()).toBe(100);
    clearHistory();
    expect(historyDepth()).toBe(0);
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

describe('compressBest（压缩阶梯粗步 + 连续细化：消除粗步过冲的底部空隙）', () => {
  const spec = computeLayoutSpec({ blocks: [] });

  it('Given 标称态放得下 When 求解 Then 原样返回零压缩', () => {
    const r = compressBest(spec, () => 0);
    expect(r.st).toEqual(defaultSpacing(spec));
    expect(r.over).toBe(0);
  });

  it('Given 间距阶段存在换行悬崖（s=0.25 溢出、s=0.5 放得下）When 求解 Then s 细化到悬崖边缘而非整档 0.5', () => {
    // 悬崖在 s=0.4：粗步 0.25 失败 / 0.5 成功，细化应收敛到 (0.4, 0.42]
    const probe: OverflowProbe = (st) => (st.s < 0.4 ? 20 : 0);
    const r = compressBest(spec, probe);
    expect(r.st.s).toBeGreaterThan(0.4);
    expect(r.st.s).toBeLessThanOrEqual(0.42);
    expect(r.st.fit).toBe(1);
    expect(probe(r.st)).toBeLessThanOrEqual(FIT_TOL);
  });

  it('Given 字号阶段悬崖（fit>0.67 溢出、0.65 放得下）且留有余量 When 求解 Then fit 细化上探且 s 回松', () => {
    // fit 悬崖 0.67；s 越松内容越高（(1-s)*60），0.65 档在 s=1 有 60px 余量可回松
    const probe: OverflowProbe = (st) => (st.fit > 0.67 ? 500 : 0) + (1 - st.s) * 60;
    const r = compressBest(spec, probe);
    expect(r.st.fit).toBeGreaterThan(0.65);   // 字号比粗步档更大（合约：余量优先还给字号）
    expect(r.st.fit).toBeLessThanOrEqual(0.67);
    expect(r.st.s).toBeLessThan(1);           // 剩余余量用间距松度吸收 → 内容贴页脚
    expect(probe(r.st)).toBeLessThanOrEqual(FIT_TOL);
  });

  it('Given 全程放不下 When 求解 Then 返回溢出最小态（字/距/图全到底）', () => {
    const probe: OverflowProbe = (st) => 100 - st.s * 20 - (1 - st.fit) * 50 - (spec.imgHNom - st.imgH) * 0.5;
    const r = compressBest(spec, probe);
    expect(r.st.s).toBe(1);
    expect(r.st.fit).toBeCloseTo(spec.fitMin, 6);
    expect(r.st.imgH).toBeCloseTo(IMG_H_MIN, 6);
    expect(r.over).toBeGreaterThan(FIT_TOL);  // 容忍溢出（上层 toast 建议删减）
  });

  it('Given 图高阶段悬崖（imgH>40 溢出、≤40 放得下）When 求解 Then imgH 细化到悬崖边缘（图尽量大）', () => {
    // 字/距全到底仍溢出，只有压图放得下：悬崖在 imgH=40，粗步 55→46.75 失败 → 39.74 成功
    const probe: OverflowProbe = (st) => (st.s < 1 || st.fit > spec.fitMin || st.imgH > 40 ? 500 : 0);
    const r = compressBest(spec, probe);
    expect(r.st.s).toBe(1);
    expect(r.st.fit).toBeCloseTo(spec.fitMin, 6);
    expect(r.st.imgH).toBeGreaterThan(39);
    expect(r.st.imgH).toBeLessThanOrEqual(40.1);
    expect(probe(r.st)).toBeLessThanOrEqual(FIT_TOL);
  });
});


describe('moveSlide（大纲拖拽换序：层级归属自动重算 + 特殊页禁区）', () => {
  const MD = [
    '---\nbeamerapp: 1\n---\n',
    ':::: title\n::::\n\n:::: toc\n::::\n',
    '# 甲\n\n:::: slide title="甲1"\nA1\n::::\n\n:::: slide title="甲2"\nA2\n::::\n',
    '# 乙\n\n:::: slide title="乙1"\nB1\n::::\n',
    ':::: end\n::::\n',
  ].join('');
  const setup = () => {
    useStore.getState().loadProjectData({ md: MD, folder: '/tmp/z' });
    const idOf = (title: string) => {
      const p = useStore.getState().computed.pages.find((x) => x.kind === 'slide' && x.slide.title === title);
      return p && p.kind === 'slide' ? p.slide.id : null;
    };
    // zustand getState() 返回快照——computed 每次 mutate 后是新引用，必须现取
    const titles = () => useStore.getState().computed.pages
      .filter((x) => x.kind === 'slide' && !['title', 'toc', 'end'].includes(x.slide.layout))
      .map((x) => (x.kind === 'slide' ? x.slide.title ?? '' : ''));
    const act = () => useStore.getState();
    return { act, idOf, titles };
  };

  it('跨节移动：甲1 拖到乙1 前 → 页序变化且 sectionPath 归入乙节；md 序持久化', () => {
    const { act, idOf, titles } = setup();
    const a1 = idOf('甲1');
    const b1 = idOf('乙1');
    expect(a1).toBeTruthy();
    expect(b1).toBeTruthy();
    act().moveSlide(a1!, b1!);
    expect(titles()).toEqual(['甲2', '甲1', '乙1']);
    const moved = useStore.getState().computed.pages.find((x) => x.kind === 'slide' && x.slide.title === '甲1');
    expect(moved && moved.kind === 'slide' ? moved.sectionPath.map((s) => s.title) : null).toEqual(['乙']);
    const md = serializeMarkdown(useStore.getState().deck);
    expect(md.indexOf('甲2')).toBeLessThan(md.indexOf('甲1'));
    expect(md.indexOf('甲1')).toBeLessThan(md.indexOf('乙1'));
  });

  it('beforeId=null → 移到 deck 末尾', () => {
    const { act, idOf, titles } = setup();
    act().moveSlide(idOf('甲2')!, null);
    expect(titles().at(-1)).toBe('甲2');
  });

  it('目标不存在 → no-op；同页自移 → no-op', () => {
    const { act, idOf, titles } = setup();
    const before = titles();
    act().moveSlide(idOf('乙1')!, 'nonexistent');
    expect(titles()).toEqual(before);
    act().moveSlide(idOf('乙1')!, idOf('乙1')!);
    expect(titles()).toEqual(before);
  });

  it('页级页脚 foot 属性：解析 → 序列化往返幂等', () => {
    const md = '---\nbeamerapp: 1\n---\n\n:::: slide title="页" foot="本页专属页脚"\n内容\n::::\n';
    const deck = parseMarkdown(md);
    const sl = deck.items[0];
    expect(sl && sl.kind === 'slide' ? sl.slide.footNote : null).toBe('本页专属页脚');
    const out = serializeMarkdown(deck);
    expect(out).toContain('foot="本页专属页脚"');
    // 再解析往返稳定
    const deck2 = parseMarkdown(out);
    const sl2 = deck2.items[0];
    expect(sl2 && sl2.kind === 'slide' ? sl2.slide.footNote : null).toBe('本页专属页脚');
  });
});
