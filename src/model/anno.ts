// 注释公式块（annoeq）数据模型 —— 移植自 Web 版 annotate-equations 复刻。
// 概念对照 LaTeX annotate-equations 宏包：
//   \eqnmarkbox   → mark.type='box'   底色高亮框（颜色!shade 混白）
//   \eqnmark      → mark.type='text'  文字着色
//   \tikzmarknode → mark.type='plain' 隐形锚点
//   \annotate     → ann.type='one'    肘形箭头指向公式，标签锚定于首标记
//   \annotatetwo  → ann.type='two'    双向箭头连接两标记，标签居中于中点
// 锚定与字号解耦：标记 = 渲染文本 needle+occurrence；偏移 = ex/em 相对量。
// 展示端在任何字号下重新测量几何（components/anno/engine.ts），
// 页面排版（fontScale/fit 压缩/比例切换）自动跟随，无需生成位图。

import { newId } from './types';

export interface AnnoMark {
  id: string;
  name: string;
  type: 'box' | 'text' | 'plain';
  color: string | null; // plain 无色
  /** 渲染文本中的锚定片段（KaTeX 可见文本，非 LaTeX 源码） */
  needle: string;
  /** needle 在全文中的第几次出现（0 起） */
  occ: number;
}

export interface AnnoAnnotation {
  id: string;
  type: 'one' | 'two';
  /** $..$ 为数学片段，\\\\ 换行 */
  text: string;
  pos: 'above' | 'below' | 'above-left' | 'below-left';
  /** annotatetwo 的 "label below"（线在标签上缘） */
  labelBelow: boolean;
  colorAuto: boolean;
  color: string;
  /** 水平偏移（ex，TikZ x 轴向右） */
  xshift: number;
  /** 垂直偏移（em，TikZ y 轴向上） */
  yshift: number;
  markIds: string[];
}

export interface AnnoState {
  /** 编辑画布基准字号 px（仅影响编辑视口舒适度；展示端按页面实际字号重算几何） */
  fontSize: number;
  /** 展示态公式放大（相对正文 1em；注释公式为「主视觉」块，标注文字需可读。
   *  仅影响幻灯片渲染，编辑画布用 fontSize 独立控制） */
  scale: number;
  /** 高亮框底色浓度：原色占比 %，其余混白 */
  shade: number;
  /** 高亮框统一 mathstrut 高度（宏包默认行为） */
  equalHeight: boolean;
  /** fboxsep 内边距缩放（1 = 官方 0.3em；0.5 = 紧凑默认） */
  fboxScale: number;
  /** 标注文字字号比例（相对公式 KaTeX 字号） */
  annFontScale: number;
  /** 标注文字字体：auto = 随主题（.sv 的 serif/sans 栈） */
  labelFont: 'auto' | 'serif' | 'sans';
  /** 下一枚标记色在 ANNO_PALETTE 的下标 */
  paletteIdx: number;
  marks: AnnoMark[];
  annotations: AnnoAnnotation[];
}

/** dvipsnames 风格调色板（与 fcn 一致；注释语义需要多可区分色） */
export const ANNO_PALETTE = [
  '#2A4FC7', // NavyBlue
  '#4E9A2E', // OliveGreen
  '#E61A8C', // WildStrawberry
  '#7A4FD0', // Plum
  '#5B3FA8', // RoyalPurple
  '#1273A3', // TealBlue
  '#D25F1E', // BurntOrange
  '#2E8B57', // ForestGreen
  '#C41E3A', // CardinalRed
  '#D9A514', // Goldenrod
];

export function defaultAnnoState(): AnnoState {
  return {
    fontSize: 30,
    scale: 1.5,
    shade: 17,
    equalHeight: true,
    fboxScale: 0.5,
    annFontScale: 0.5,
    labelFont: 'auto',
    paletteIdx: 0,
    marks: [],
    annotations: [],
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 外部 JSON（md 契约 / 旧数据）→ 合法 AnnoState；任何字段损坏回退默认 */
function normalizeAnnoState(raw: unknown): AnnoState {
  const s = defaultAnnoState();
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const f = num(o.fontSize); if (f != null) s.fontSize = clamp(Math.round(f), 10, 60);
  const sc = num(o.scale); if (sc != null) s.scale = clamp(sc, 0.5, 2);
  const sh = num(o.shade); if (sh != null) s.shade = clamp(Math.round(sh), 0, 100);
  s.equalHeight = o.equalHeight === undefined ? true : !!o.equalHeight;
  const fb = num(o.fboxScale); if (fb != null) s.fboxScale = clamp(fb, 0, 1);
  const af = num(o.annFontScale); if (af != null) s.annFontScale = clamp(af, 0.2, 1);
  if (o.labelFont === 'serif' || o.labelFont === 'sans') s.labelFont = o.labelFont;
  const pi = num(o.paletteIdx); if (pi != null) s.paletteIdx = Math.max(0, Math.round(pi));
  s.marks = (Array.isArray(o.marks) ? o.marks : []).map((m): AnnoMark => {
    const r = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
    const type = r.type === 'text' || r.type === 'plain' ? r.type : 'box';
    const color = typeof r.color === 'string' && HEX.test(r.color) ? r.color : null;
    return {
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      name: String(r.name || 'm'),
      type,
      color: type === 'plain' ? null : color,
      needle: String(r.needle || ''),
      occ: Math.max(0, Math.round(num(r.occ) ?? 0)),
    };
  }).filter((m) => m.needle);
  const idSet = new Set(s.marks.map((m) => m.id));
  s.annotations = (Array.isArray(o.annotations) ? o.annotations : []).map((a): AnnoAnnotation => {
    const r = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    const pos = r.pos === 'below' || r.pos === 'above-left' || r.pos === 'below-left' ? r.pos : 'above';
    return {
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      type: r.type === 'two' ? 'two' : 'one',
      text: String(r.text || ''),
      pos,
      labelBelow: !!r.labelBelow,
      colorAuto: r.colorAuto !== false,
      color: typeof r.color === 'string' && HEX.test(r.color) ? r.color : '#000000',
      xshift: num(r.xshift) ?? 0,
      yshift: num(r.yshift) ?? 0,
      markIds: (Array.isArray(r.markIds) ? r.markIds : []).filter((id): id is string =>
        typeof id === 'string' && idSet.has(id)),
    };
  });
  return s;
}

/** md 契约载体：annoeq 块体首行 `%%anno {单行 JSON}` */
export function annoToJson(s: AnnoState): string {
  return JSON.stringify(s);
}

export function annoFromJson(json: string | undefined | null): AnnoState {
  if (!json) return defaultAnnoState();
  try {
    return normalizeAnnoState(JSON.parse(json));
  } catch {
    return defaultAnnoState();
  }
}
