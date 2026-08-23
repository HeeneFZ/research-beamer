// Compute pages & cross-reference numbering over a deck.
//
// - pages: 含自动节分隔页的渲染页序列
// - 节编号恒为 1 / 1.1 / 1.1.1；公式/图/表编号按 config.numbering 连续或按节

import { Deck, Page, Section, Slide } from './types';

export type RefKind = 'sec' | 'eq' | 'fig' | 'tab';

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
  /** eq/fig/tab label -> 所在页 index（跳转用） */
  labelPageIndex: Map<string, number>;
  /** section id -> 该节第一页 index（含分隔页自身） */
  sectionPageIndex: Map<string, number>;
}

const REF_RE = /^(\w+):([\w-]+)$/;

/** 裸标签（eq:x / fig:y / sec:z / tab:w）解析；tokenizer 已剥去 [@ ] */
export function refParts(label: string): { kind: RefKind; key: string } | null {
  const m = label.trim().match(REF_RE);
  if (!m) return null;
  const kind = m[1] as RefKind;
  if (kind !== 'sec' && kind !== 'eq' && kind !== 'fig' && kind !== 'tab') return null;
  return { kind, key: m[2] };
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
    labelPageIndex, sectionPageIndex,
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

