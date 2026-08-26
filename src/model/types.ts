// Core deck model types

import type { AnnoState } from './anno';

/** 页面版式 */
export type Layout = 'title' | 'toc' | 'section' | 'content' | 'twoCol' | 'end';

export type BlockType =
  | 'paragraph'
  | 'itemize'
  | 'equation'
  | 'annoeq' // 注释公式块：公式 + 交互式引线标注（annotate-equations 式）
  | 'figure'
  | 'video'
  | 'table'
  | 'colmark' // 双栏区开始（第二个起切右栏）
  | 'colend'; // 结束双栏区，回单栏

/** 自由定位（双轨布局）：x/y/w 均为页宽/高的百分比 */
export interface Pos {
  x: number;
  y: number;
  w: number;
}

export interface Block {
  id: string;
  type: BlockType;
  /** paragraph / itemize 标题等行内文本（$..$、[@eq:x]、[..]{color=role}、**粗体**） */
  text?: string;
  /** itemize 条目 */
  items?: string[];
  /** equation latex 源（\label 已在解析时摘出；可含 \annotate[role]{..}{..}） */
  latex?: string;
  /** annoeq 注释公式块的标注数据（标记/标注/样式），见 model/anno.ts */
  anno?: AnnoState;
  /** equation / annoeq / figure / table 交叉引用标签（eq:x / fig:x / tab:x） */
  label?: string;
  /** figure / video 相对工程路径（media/xxx） */
  src?: string;
  /** 显示宽度占文本区比例 (0,1]，figure/video 用 */
  width?: number;
  /** figure / table caption */
  caption?: string;
  /** video 自动播放 */
  autoplay?: boolean;
  /** table cells：cells[行][列]，cells[0] 为表头行 */
  cells?: string[][];
  /** 自由定位（拖拽设置） */
  pos?: Pos;
  /** 出现动画顺序（1 起；未设置无动画） */
  order?: number;
  /** itemize 逐项出现动画顺序（与 items 按下标对齐；项缺省=随块/恒显示） */
  itemOrders?: (number | undefined)[];
}

export interface Slide {
  id: string;
  layout: Layout;
  /** 内容页帧标题（行内语法）；title/toc/end 页可用 attrs 覆盖默认文案 */
  title?: string;
  /** twoCol 左栏宽度占比 */
  ratio?: number;
  /** 本页正文区字号比例（相对全局标准 fontSize，0.6–1.5；缺省 1）。
   *  只影响正文区（段落/列表/公式/表格/题注），页眉/页脚永不变化 */
  fontScale?: number;
  /** 演讲稿（纯文本多行） */
  notes?: string;
  blocks: Block[];
}

export interface Section {
  id: string;
  /** 1=section 2=subsection 3=subsubsection */
  level: 1 | 2 | 3;
  title: string;
  /** {#sec:label} */
  label?: string;
}

export type DeckItem =
  | { kind: 'section'; section: Section }
  | { kind: 'slide'; slide: Slide };

export interface Tone {
  base: string;
  deep: string;
}

export interface Palette {
  preset?: string;
  primary: Tone;
  accent: Tone;
  emphasis: Tone;
  text: string;
  textMuted: string;
  bg: string;
  bgAlt: string;
}

export type Language = 'zh' | 'en';
export type Aspect = '16:9' | '4:3';

export interface DeckConfig {
  beamerapp: number;
  title: string;
  authors: string;
  affiliations: string;
  date: string;
  shortTitle: string;
  language: Language;
  aspect: Aspect;
  numbering: 'continuous' | 'perSection';
  fontZh: 'serif' | 'sans';
  fontEn: 'serif' | 'sans';
  sectionPages: boolean;
  /** 封面/结尾页校徽或自定义图案（相对路径，如 media/高校logo.svg） */
  logo?: string;
  /** Logo 浮动位置（拖拽/调宽后持久化）：x/y = 左上角（页宽/高百分比），w = 宽（页宽百分比）。
   *  未设置时为锚定态——渲染在封面/结尾页色块卡片右下角（卡片相对定位，卡片高度变化恒贴合） */
  logoPos?: Pos;
  /** 全局标准正文字号（PPT 等效 pt，默认 16；页眉标题=×4/3、题注=×15/18、页脚=×2/3 推导；
   *  每页可用 fontScale 在 60%–150% 内调整正文区） */
  fontSize: number;
  palette: Palette;
}

export interface Deck {
  config: DeckConfig;
  items: DeckItem[];
}

/** 渲染页（含自动生成的节分隔页） */
export interface Page {
  /** 0 基页索引 */
  index: number;
  kind: 'slide' | 'divider';
  slide?: Slide;
  section?: Section; // divider 页对应节
  /** 当前 [section, subsection, subsubsection] 上下文 */
  sectionPath: Section[];
  /** 1 基页码 */
  no: number;
}

export const defaultConfig: DeckConfig = {
  beamerapp: 1,
  title: '未命名汇报',
  authors: '',
  affiliations: '',
  date: '',
  shortTitle: '',
  language: 'zh',
  aspect: '16:9',
  numbering: 'continuous',
  fontZh: 'serif',
  fontEn: 'serif',
  sectionPages: true,
  fontSize: 16,
  palette: {
    preset: 'academic-blue',
    primary: { base: '#0F66AD', deep: '#083264' },
    accent: { base: '#E8912D', deep: '#AB540F' },
    emphasis: { base: '#2E9E6B', deep: '#186D52' },
    text: '#1F2328',
    textMuted: '#5A6470',
    bg: '#FFFFFF',
    bgAlt: '#F2F5F9',
  },
};

export const PAGE_SIZE: Record<Aspect, { w: number; h: number }> = {
  '16:9': { w: 160, h: 90 },
  '4:3': { w: 128, h: 96 },
};

let counter = 0;
export function newId(): string {
  counter += 1;
  return 'b' + counter.toString(36) + Date.now().toString(36).slice(-4);
}
