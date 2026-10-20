// Compute pages & cross-reference numbering over a deck.
//
// - pages: 含自动节分隔页的渲染页序列
// - 节编号恒为 1 / 1.1 / 1.1.1；公式/图/表编号按 config.numbering 连续或按节

import { Block, Deck, Page, Section, Slide } from './types';

export type RefKind = 'sec' | 'eq' | 'fig' | 'tab' | 'ref';

export interface Computed {
  pages: Page[];
  /** section id -> "1" / "1.1" / "1.1.1" */
  sectionNum: Map<string, string>;
  /** sec label -> 编号文本 */
  sectionNumByLabel: Map<string, string>;
  /** equation block id -> 编号文本（"3" 或 "1.2"） */
  equationNum: Map<string, string>;
  equationNumByLabel: Map<string, string>;
  figureNum: Map<string, string>;
  figureNumByLabel: Map<string, string>;
  tableNum: Map<string, string>;
  tableNumByLabel: Map<string, string>;
  textRefByLabel: Map<string, string>;
  /** eq/fig/tab label -> 所在页 index（跳转用） */
  labelPageIndex: Map<string, number>;
  /** section id -> 该节第一页 index（含分隔页自身） */
  sectionPageIndex: Map<string, number>;
}

/** 页序与编号成员不变时复用编号表，只更新被编辑页；其它情况交回全量计算。 */
export function patchComputedSlide(computed: Computed, before: Slide, after: Slide): Computed | null {
  if (before.id !== after.id) return null;
  const kind = (block: Block): RefKind | null => {
    if ((block.type === 'equation' || block.type === 'annoeq') && block.latex != null) return 'eq';
    if (block.type === 'figure' && block.src != null) return 'fig';
    if (block.type === 'table' && block.cells != null) return 'tab';
    return null;
  };
  // Ordinary typing keeps the numbering maps. Only changed reference labels
  // invalidate the global reference map; target prose never determines display.
  let samePositions = before.blocks.length === after.blocks.length;
  if (samePositions) {
    for (let i = 0; i < before.blocks.length; i++) {
      const old = before.blocks[i], next = after.blocks[i];
      if (old === next) continue;
      if (textTargetSignature(old) !== textTargetSignature(next)) return null;
      const oldKind = kind(old), nextKind = kind(next);
      if (oldKind !== nextKind || oldKind && (old.id !== next.id || old.label !== next.label)) return null;
      if (old.id !== next.id) samePositions = false;
    }
  } else if (before.blocks.map(textTargetSignature).join('') !== after.blocks.map(textTargetSignature).join('')) return null;
  if (!samePositions) {
    const oldNumbered = before.blocks.filter((block) => kind(block) != null);
    const newNumbered = after.blocks.filter((block) => kind(block) != null);
    if (oldNumbered.length !== newNumbered.length) return null;
    for (let i = 0; i < oldNumbered.length; i++) {
      const old = oldNumbered[i], next = newNumbered[i];
      if (old.id !== next.id || old.label !== next.label || kind(old) !== kind(next)) return null;
    }
  }
  const at = computed.pages.findIndex((page) => page.kind === 'slide' && page.slide?.id === before.id);
  if (at < 0) return null;
  const pages = computed.pages.slice();
  pages[at] = { ...pages[at], slide: after };
  return { ...computed, pages };
}

const REF_RE = /^(\w+):([\w-]+)$/;

/** 裸标签（eq:x / fig:y / sec:z / tab:w）解析；tokenizer 已剥去 [@ ] */
export function refParts(label: string): { kind: RefKind; key: string } | null {
  const m = label.trim().match(REF_RE);
  if (!m) return null;
  const kind = m[1] as RefKind;
  if (kind !== 'sec' && kind !== 'eq' && kind !== 'fig' && kind !== 'tab' && kind !== 'ref') return null;
  return { kind, key: m[2] };
}

/** Every generic reference displays its label key, including bibliography targets. */
export function genericRefText(label: string): string {
  return `[${label.replace(/^ref:/, '')}]`;
}

const textTargetSignatures = new WeakMap<Block, string>();
function textTargetSignature(block: Block): string {
  if (!block.label?.startsWith('ref:') && !block.itemLabels) return '';
  let signature = textTargetSignatures.get(block);
  if (signature != null) return signature;
  const targets: string[] = [];
  if (block.label?.startsWith('ref:')) targets.push(block.label);
  block.itemLabels?.forEach((label, i) => {
    if (label && i < (block.items?.length ?? 0)) targets.push(label);
  });
  signature = targets.length ? JSON.stringify(targets) : '';
  textTargetSignatures.set(block, signature);
  return signature;
}

export function computeDeck(deck: Deck): Computed {
  const perSection = deck.config.numbering === 'perSection';
  const pages: Page[] = [];
  const sectionNum = new Map<string, string>();
  const sectionNumByLabel = new Map<string, string>();
  const equationNum = new Map<string, string>();
  const equationNumByLabel = new Map<string, string>();
  const figureNum = new Map<string, string>();
  const figureNumByLabel = new Map<string, string>();
  const tableNum = new Map<string, string>();
  const tableNumByLabel = new Map<string, string>();
  const textRefByLabel = new Map<string, string>();
  const labelPageIndex = new Map<string, number>();
  const sectionPageIndex = new Map<string, number>();

  let sec = 0, sub = 0, subsub = 0;
  let eq = 0, fig = 0, tab = 0;
  let eqSec = 0, figSec = 0, tabSec = 0; // 当前节内计数（perSection）
  const path: (Section | null)[] = [null, null, null];

  const numText = (kind: 'eq' | 'fig' | 'tab') => {
    if (!perSection || sec === 0) {
      return String(kind === 'eq' ? eq : kind === 'fig' ? fig : tab);
    }
    const n = kind === 'eq' ? eqSec : kind === 'fig' ? figSec : tabSec;
    return `${sec}.${n}`;
  };

  const sectionPath = () => path.filter((s): s is Section => s !== null);

  const pushPage = (p: Omit<Page, 'index' | 'no'>) => {
    pages.push({ ...p, index: pages.length, no: pages.length + 1 });
  };

  const visit = (slide: Slide) => {
    pushPage({ kind: 'slide', slide, sectionPath: sectionPath() });
    const pageIdx = pages.length - 1;
    for (const b of slide.blocks) {
      if (b.label?.startsWith('ref:')) {
        textRefByLabel.set(b.label, genericRefText(b.label));
        labelPageIndex.set(b.label, pageIdx);
      }
      b.itemLabels?.forEach((label, i) => {
        if (!label || i >= (b.items?.length ?? 0)) return;
        textRefByLabel.set(label, genericRefText(label));
        labelPageIndex.set(label, pageIdx);
      });
      if ((b.type === 'equation' || b.type === 'annoeq') && b.latex != null) {
        eq++; eqSec++;
        equationNum.set(b.id, numText('eq'));
        if (b.label) {
          equationNumByLabel.set(b.label, numText('eq'));
          labelPageIndex.set(b.label, pageIdx);
        }
      } else if (b.type === 'figure' && b.src != null) {
        fig++; figSec++;
        figureNum.set(b.id, numText('fig'));
        if (b.label) {
          figureNumByLabel.set(b.label, numText('fig'));
          labelPageIndex.set(b.label, pageIdx);
        }
      } else if (b.type === 'table' && b.cells != null) {
        tab++; tabSec++;
        tableNum.set(b.id, numText('tab'));
        if (b.label) {
          tableNumByLabel.set(b.label, numText('tab'));
          labelPageIndex.set(b.label, pageIdx);
        }
      }
    }
  };

  for (const it of deck.items) {
    if (it.kind === 'section') {
      const s = it.section;
      if (s.level === 1) {
        sec++; sub = 0; subsub = 0; eqSec = 0; figSec = 0; tabSec = 0;
        path[0] = s; path[1] = null; path[2] = null;
        sectionNum.set(s.id, String(sec));
        if (s.label) sectionNumByLabel.set(s.label, String(sec));
        if (deck.config.sectionPages) {
          pushPage({ kind: 'divider', section: s, sectionPath: sectionPath() });
          sectionPageIndex.set(s.id, pages.length - 1);
          if (s.label) sectionPageIndex.set(s.label, pages.length - 1);
        } else {
          sectionPageIndex.set(s.id, pages.length); // 下一页（若有）
          if (s.label && !sectionPageIndex.has(s.label)) sectionPageIndex.set(s.label, pages.length);
        }
      } else if (s.level === 2) {
        sub++; subsub = 0; // 节内公式/图/表计数只在 level-1（章）重置：小节清零会出两个 2.1
        path[1] = s; path[2] = null;
        const t = `${sec}.${sub}`;
        sectionNum.set(s.id, t);
        if (s.label) sectionNumByLabel.set(s.label, t);
        if (!sectionPageIndex.has(s.id)) sectionPageIndex.set(s.id, pages.length);
        if (s.label && !sectionPageIndex.has(s.label)) sectionPageIndex.set(s.label, pages.length);
      } else {
        subsub++;
        path[2] = s;
        const t = `${sec}.${sub}.${subsub}`;
        sectionNum.set(s.id, t);
        if (s.label) sectionNumByLabel.set(s.label, t);
        if (!sectionPageIndex.has(s.id)) sectionPageIndex.set(s.id, pages.length);
        if (s.label && !sectionPageIndex.has(s.label)) sectionPageIndex.set(s.label, pages.length);
      }
    } else {
      visit(it.slide);
    }
  }

  return {
    pages, sectionNum, sectionNumByLabel,
    equationNum, equationNumByLabel,
    figureNum, figureNumByLabel,
    tableNum, tableNumByLabel,
    labelPageIndex, sectionPageIndex, textRefByLabel,
  };
}

/** 引用 label → 所在页 index（eq/fig/tab 查 label 页；sec 回退节首页）；未找到 null。
 *  接受裸键（"x"）或带前缀（"eq:x"）——编辑器跳转与行内渲染的统一解析入口。 */
export function refPageIndex(label: string, c: Computed): number | null {
  const parts = refParts(label.includes(':') ? label : `eq:${label}`);
  if (!parts) return null;
  const full = `${parts.kind}:${parts.key}`;
  // 表键恒带前缀（normLabel 在解析/UI 层强制 xxx:），裸键查找是死分支
  const idx = c.labelPageIndex.get(full);
  const secIdx = parts.kind === 'sec' ? c.sectionPageIndex.get(full) : undefined;
  return idx ?? secIdx ?? null;
}

/** 引用显示文本（key 为裸键，如 gauss；内部补 kind: 前缀查表）；未知返回 null */
export function refDisplay(kind: RefKind, key: string, c: Computed, lang: 'zh' | 'en'): string | null {
  if (kind === 'ref') return c.textRefByLabel.get(`ref:${key}`) ?? null;
  const num =
    kind === 'sec' ? c.sectionNumByLabel.get(`sec:${key}`)
    : kind === 'eq' ? c.equationNumByLabel.get(`eq:${key}`)
    : kind === 'fig' ? c.figureNumByLabel.get(`fig:${key}`)
    : c.tableNumByLabel.get(`tab:${key}`);
  if (num == null) return null;
  if (kind === 'sec') return lang === 'zh' ? `第 ${num} 节` : `Sec. ${num}`;
  if (kind === 'eq') return lang === 'zh' ? `式 (${num})` : `Eq. (${num})`;
  if (kind === 'fig') return lang === 'zh' ? `图 ${num}` : `Fig. ${num}`;
  return lang === 'zh' ? `表 ${num}` : `Table ${num}`;
}

