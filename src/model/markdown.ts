// Markdown project contract: serialize/parse the whole deck.
//
// Layout of a project folder:
//   deck.md        <- front-matter config + body (this file's format)
//   media/         <- images & videos
//
// Body syntax:
//   # 节 {#sec:label} / ## 小节 / ### 子小节      结构标题（不属于任何页）
//   :::: slide layout="content|twoCol" title=".." ratio="0.5"   页容器
//   :::: title / :::: toc / :::: end [title=".."]                特殊页
//   ::: notes ... :::                            本页演讲稿
//   ::: col                                      twoCol 栏标记（第二个起右栏）
//   ::: equation label="eq:x"  ... :::           公式块
//   ::: annoeq label="eq:y"                      注释公式块（首行 %%anno {json} 为标注数据）
//     %%anno {"marks":[..],"annotations":[..]}
//     E = mc^2
//   :::

import yaml from 'js-yaml';
import {
  Block, Deck, DeckConfig, DeckItem, Layout, Palette, Pos, Slide, defaultConfig, newId,
} from './types';
import { annoFromJson, annoToJson, defaultAnnoState } from './anno';
import { LEGACY_PRESET_TONES, PRESETS } from './palette';
const SLIDE_OPEN = /^::::+\s*(.*)$/;   // 4+ colons
const BLOCK_OPEN = /^:::+\s*(.*)$/;    // 3+ colons（块级；在页内出现 4+ 也按块处理）

function escAttr(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escCell(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}
/** 行尾连续反斜杠个数（硬换行标记奇偶判定用） */
function tailBackslashes(s: string): number {
  let n = 0;
  let j = s.length - 1;
  while (j >= 0 && s[j] === '\\') { n++; j--; }
  return n;
}


/** 解析一行管道表格（支持 \| 与 \\ 转义）。
 *  调用方已剥行首外管道；行尾外管道按「位置」剥除（末字符为未转义 |）。
 *  不得按「内容为空」shift/pop 首尾段——空首/尾单元格是合法内容，
 *  按内容丢弃会导致列错位，且序列化-解析往返丢列（往返幂等契约破坏）。 */
function parseTableRow(line: string): string[] {
  let body = line;
  if (body.endsWith('|')) {
    // 末字符 '|' 前反斜杠数为偶数 → 外管道（奇数则 \| 是转义内容，不剥）
    let bs = 0;
    for (let i = body.length - 2; i >= 0 && body[i] === '\\'; i--) bs++;
    if (bs % 2 === 0) body = body.slice(0, -1);
  }
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      cur += body[i + 1];
      i++;
    } else if (c === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    attrs[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return attrs;
}

function attrStr(attrs: string[]): string {
  return attrs.length ? ' ' + attrs.join(' ') : '';
}

function q(v: string): string {
  return `"${escAttr(v)}"`;
}

const LAYOUTS: Layout[] = ['title', 'toc', 'section', 'content', 'twoCol', 'end'];

export const LABEL_PREFIX: Partial<Record<Block['type'], string>> = {
  equation: 'eq', figure: 'fig', table: 'tab', annoeq: 'eq', video: 'vid',
};

/** 裸标签补前缀：gauss -> eq:gauss（已带 xxx: 前缀的原样保留） */
export function normLabel(kind: string, label: string): string {
  return /^\w+:/.test(label) ? label : `${kind}:${label}`;
}

/** 去除引用键的双重前缀自愈：eq:eq:x -> eq:x（无重复原样返回）。
 *  picker 旧 bug 曾把带前缀的 label 再拼一次 kind 写入 [@eq:eq:x]——
 *  解析/渲染/存储三层统一在此剥除，历史脏 md 打开即修复显示 */
export function dedupeRefLabel(label: string): string {
  return label.replace(/^(\w+):\1:/, '$1:');
}

function blockOf(type: Block['type'], attrs: Record<string, string>): Block {
  const b: Block = { id: newId(), type };
  if (attrs.label != null) b.label = normLabel(LABEL_PREFIX[type] ?? 'eq', attrs.label);
  if (attrs.src != null) b.src = attrs.src;
  if (attrs.caption != null) b.caption = attrs.caption;
  if (attrs.width != null) {
    const w = parseFloat(attrs.width);
    if (Number.isFinite(w) && w > 0) b.width = Math.min(1, w);
  }
  if (attrs.autoplay != null) b.autoplay = attrs.autoplay === 'true';
  if (attrs.order != null) {
    const o = parseInt(attrs.order, 10);
    if (Number.isFinite(o) && o >= 1) b.order = o;
  }
  if (attrs.pos != null) {
    const parts = attrs.pos.split(',').map(parseFloat);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      b.pos = { x: parts[0], y: parts[1], w: parts[2] };
    }
  }
  return b;
}

/** $$..$$ / ::: equation 体：摘出 \label{..}（裸标签补 eq: 前缀） */
function extractLabel(latex: string): { latex: string; label?: string } {
  const m = latex.match(/\\label\{([^}]+)\}/);
  if (!m) return { latex };
  return { latex: latex.replace(m[0], '').trim(), label: normLabel('eq', m[1]) };
}

/** "x,y,w" → Pos（与块 pos 属性同格式；容错：非有限数返回 undefined） */
function parsePosStr(v: string | undefined): Pos | undefined {
  if (!v) return undefined;
  const parts = v.split(',').map(parseFloat);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? { x: parts[0], y: parts[1], w: parts[2] }
    : undefined;
}

function parseFrontMatter(md: string): { config: DeckConfig; body: string } {
  // 容错：Windows 记事本/部分中文编辑器写 UTF-8 带 BOM——不剥则 ^--- 不匹配，
  // 整个前言落入正文成垃圾页且配置全部回落默认
  const src = md.replace(/^\uFEFF/, '');
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return { config: { ...defaultConfig }, body: src };
  let loaded: unknown = {};
  try {
    loaded = yaml.load(fm[1]) || {};
  } catch {
    loaded = {};
  }
  const raw = (typeof loaded === 'object' && loaded !== null ? loaded : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
  const pRaw = raw.palette;
  const p = (typeof pRaw === 'object' && pRaw !== null ? pRaw : {}) as Record<string, unknown>;
  const presetName = typeof p.preset === 'string' ? p.preset : undefined;
  const presetTones = presetName && PRESETS[presetName] ? PRESETS[presetName] : null;
  const legacyTones = presetName && LEGACY_PRESET_TONES[presetName] ? LEGACY_PRESET_TONES[presetName] : null;
  const mergeTone = (name: 'primary' | 'accent' | 'emphasis'): { base: string; deep: string } => {
    // 无显式色：预设优先（带 preset 却无 tones 时回落 defaultConfig 是潜在错配）
    const d = presetTones ? presetTones[name] : defaultConfig.palette[name];
    const t = p[name];
    if (typeof t === 'string') return { base: t, deep: d.deep }; // 允许只给 base 色
    if (typeof t === 'object' && t !== null) {
      const o = t as Record<string, unknown>;
      const tone = { base: str(o.base, d.base), deep: str(o.deep, d.deep) };
      // 预设迁移：落盘值与旧预设该档完全一致 → 视为预设引用，升级到当前预设值
      const legacy = legacyTones?.[name];
      if (legacy && tone.base === legacy.base && tone.deep === legacy.deep && presetTones) return presetTones[name];
      return tone;
    }
    return d;
  };
  const palette: Palette = {
    preset: typeof p.preset === 'string' ? p.preset : undefined,
    primary: mergeTone('primary'),
    accent: mergeTone('accent'),
    emphasis: mergeTone('emphasis'),
    text: str(p.text, defaultConfig.palette.text),
    textMuted: str(p.textMuted, defaultConfig.palette.textMuted),
    bg: str(p.bg, defaultConfig.palette.bg),
    bgAlt: str(p.bgAlt, defaultConfig.palette.bgAlt),
  };
  const config: DeckConfig = {
    ...defaultConfig,
    title: str(raw.title, defaultConfig.title),
    authors: str(raw.authors, ''),
    affiliations: str(raw.affiliations, ''),
    date: str(raw.date, ''),
    shortTitle: str(raw.shortTitle, ''),
    language: raw.language === 'en' ? 'en' : 'zh',
    aspect: raw.aspect === '4:3' ? '4:3' : '16:9',
    numbering: raw.numbering === 'perSection' ? 'perSection' : 'continuous',
    fontZh: raw.fontZh === 'sans' ? 'sans' : 'serif',
    fontEn: raw.fontEn === 'sans' ? 'sans' : 'serif',
    sectionPages: raw.sectionPages !== false,
    fontSize: (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize) && raw.fontSize >= 10 && raw.fontSize <= 40)
      ? raw.fontSize : 16,
    logo: typeof raw.logo === 'string' && raw.logo ? raw.logo : undefined,
    logoPos: parsePosStr(raw.logoPos != null ? String(raw.logoPos) : undefined),
    palette,
  };
  return { config, body: src.slice(fm[0].length) };
}

export function parseMarkdown(md: string): Deck {
  const { config, body } = parseFrontMatter(md);
  const lines = body.split(/\r?\n/);
  const items: DeckItem[] = [];

  let loose: string[] | null = null; // 松散文本 → 隐式内容页（容错）
  const flushLoose = () => {
    if (loose && loose.length) {
      const blocks: Block[] = loose.map((tx) => ({ id: newId(), type: 'paragraph' as const, text: tx }));
      items.push({ kind: 'slide', slide: { id: newId(), layout: 'content', blocks } });
    }
    loose = null;
  };

  let i = 0;
  // 闭合规则（无歧义）：恰好 3 冒号 = 块闭合；4+ 冒号 = 页栏（开或闭）
  const isBlockClose = (ln: string) => /^:::\s*$/.test(ln);
  const isSlideFence = (ln: string) => /^::::/.test(ln.trim());

  while (i < lines.length) {
    const raw = lines[i];
    const ln = raw.trimEnd();

    // ---- 结构标题 ----
    const h = ln.match(/^(#{1,3})\s+(.*)$/);
    if (h && !/^::::/.test(ln)) {
      flushLoose();
      const level = h[1].length as 1 | 2 | 3;
      let title = h[2].trim();
      let label: string | undefined;
      const lm = title.match(/\{#([^}]+)\}\s*$/);
      if (lm) {
        label = normLabel('sec', lm[1]);
        title = title.slice(0, lm.index).trim();
      }
      items.push({ kind: 'section', section: { id: newId(), level, title, label } });
      i++;
      continue;
    }

    // ---- 页容器 ----::::
    const so = ln.match(SLIDE_OPEN);
    if (so) {
      flushLoose();
      const rest = so[1].trim();
      let layout: Layout = 'content';
      let attrSrc = rest;
      const head = rest.split(/\s+/)[0];
      if (head === 'title' || head === 'toc' || head === 'end' || head === 'section') {
        layout = head as Layout;
        attrSrc = rest.slice(head.length).trim();
      } else if (head === 'slide') {
        attrSrc = rest.slice(head.length).trim();
      }
      const attrs = parseAttrs(attrSrc);
      if (attrs.layout && LAYOUTS.includes(attrs.layout as Layout)) layout = attrs.layout as Layout;
      const slide: Slide = { id: newId(), layout, blocks: [] };
      if (attrs.title != null) slide.title = attrs.title;
      if (attrs.ratio != null) {
        const r = parseFloat(attrs.ratio);
        if (Number.isFinite(r) && r > 0.1 && r < 0.9) slide.ratio = r;
      }
      // 本页正文区字号比例（相对全局标准 fontSize，钳 0.6–1.5）
      if (attrs.fontScale != null) {
        const f = parseFloat(attrs.fontScale);
        if (Number.isFinite(f) && f > 0) slide.fontScale = Math.min(1.5, Math.max(0.6, f));
      }
      i++;
      // 收集页内块直至闭栏 ::::
      let para: string[] = [];
      let listItems: string[] | null = null;
      let listOrders: (number | undefined)[] = [];
      let listBlockOrder: number | undefined;
      const flushPara = () => {
        if (para.length) {
          // 段落末行尾 {order=N} = 出现动画顺序（1 起；与节标题 {#sec:x} 同风格的行尾标记）
          let order: number | undefined;
          const lastIdx = para.length - 1;
          const om = para[lastIdx].match(/\s*\{order=(\d+)\}\s*$/);
          if (om) {
            const o = parseInt(om[1], 10);
            if (o >= 1) order = o;
            para[lastIdx] = para[lastIdx].slice(0, om.index);
          }
          // 硬换行（块内 Shift+Enter，块文本内为 \n）：非末行行尾反斜杠计数 m——
          // 奇数 = 硬换行标记，剥 (m+1)/2 个、保留 (m-1)/2 个字面反斜杠；
          // 偶数（含 0）= 字面量原样。序列化侧成对加倍（见 serializeSlide），
          // 任意行尾反斜杠个数往返不变；末行无标记语义、原样保留
          let text = '';
          for (let k = 0; k < para.length; k++) {
            const last = k === para.length - 1;
            const l0 = para[k];
            let hard = false;
            if (!last) {
              const m = tailBackslashes(l0);
              if (m % 2 === 1) {
                text += l0.slice(0, l0.length - (m + 1) / 2) + '\n';
                hard = true;
              }
            }
            if (!hard) {
              text += l0;
              if (!last) text += ' ';
            }
          }
          const nb: Block = { id: newId(), type: 'paragraph', text };
          if (order != null) nb.order = order;
          slide.blocks.push(nb);
          para = [];
        }
      };
      const flushList = () => {
        if (listItems && listItems.length) {
          const nb: Block = { id: newId(), type: 'itemize', items: listItems };
          if (listOrders.some((o) => o != null)) nb.itemOrders = listOrders.slice();
          if (listBlockOrder != null) nb.order = listBlockOrder;
          slide.blocks.push(nb);
        }
        listItems = null;
        listOrders = [];
        listBlockOrder = undefined;
      };
      while (i < lines.length && !SLIDE_OPEN.test(lines[i].trim())) {
        const l = lines[i].trimEnd();
        const t = l.trim();
        if (!t) {
          flushPara();
          flushList();
          i++;
          continue;
        }
        // ::: 块
        const bo = l.match(BLOCK_OPEN);
        if (bo) {
          flushPara();
          flushList();
          const rest2 = bo[1].trim();
          const kind = rest2.split(/\s+/)[0];
          const attrs = parseAttrs(rest2);
          if (kind === 'col') {
            slide.blocks.push({ id: newId(), type: 'colmark' });
            i++;
            continue;
          }
          if (kind === '/col') {
            slide.blocks.push({ id: newId(), type: 'colend' });
            i++;
            continue;
          }
          i++;
          if (kind === 'notes') {
            const buf: string[] = [];
            while (i < lines.length && !isBlockClose(lines[i]) && !isSlideFence(lines[i])) {
              buf.push(lines[i]);
              i++;
            }
            if (isBlockClose(lines[i] ?? '')) i++;
            slide.notes = buf.join('\n').trim() || undefined;
            continue;
          }
          if (kind === 'equation') {
            const buf: string[] = [];
            while (i < lines.length && !isBlockClose(lines[i]) && !isSlideFence(lines[i])) {
              buf.push(lines[i]);
              i++;
            }
            if (isBlockClose(lines[i] ?? '')) i++;
            const { latex, label } = extractLabel(buf.join('\n').trim());
            const b = blockOf('equation', attrs);
            b.latex = latex;
            if (label) b.label = label;
            slide.blocks.push(b);
            continue;
          }
          if (kind === 'annoeq') {
            const buf: string[] = [];
            while (i < lines.length && !isBlockClose(lines[i]) && !isSlideFence(lines[i])) {
              buf.push(lines[i]);
              i++;
            }
            if (isBlockClose(lines[i] ?? '')) i++;
            // 首个非空行 %%anno {json} = 标注数据（单行，JSON.stringify 不产生裸换行）；
            // 其余行 = latex（内部空行原样保留，保证往返幂等）
            let k = 0;
            while (k < buf.length && !buf[k].trim()) k++;
            let annoJson: string | undefined;
            // 容错：行首空白与「%%anno{」（无空格）也认——否则标注 JSON 整行被当
            // 公式正文渲染成乱码且数据静默丢失
            const head = k < buf.length ? buf[k].trim() : '';
            if (head.startsWith('%%anno')) {
              annoJson = head.slice(6).trim();
              k++;
            }
            const latexLines = buf.slice(k);
            const { latex, label } = extractLabel(latexLines.join('\n').trim());
            const b = blockOf('annoeq', attrs);
            b.latex = latex;
            b.anno = annoFromJson(annoJson);
            if (label) b.label = label;
            slide.blocks.push(b);
            continue;
          }
          if (kind === 'figure' || kind === 'video') {
            if (i < lines.length && isBlockClose(lines[i])) i++;
            slide.blocks.push(blockOf(kind, attrs));
            continue;
          }
          if (kind === 'table') {
            const rows: string[][] = [];
            while (i < lines.length && !isBlockClose(lines[i]) && !isSlideFence(lines[i])) {
              const rl = lines[i].trim();
              // 行首外管道可省：含 | 的非空行都按表格行解析（无 | 的行忽略）
              if (rl && rl.includes('|')) {
                const body = rl[0] === '|' ? rl.slice(1) : rl;
                // 分隔行 |---|---|（含无外管道形态 ---|---）跳过：须每列均为
                // :-型分隔单元（≥2 短横）且至少一列非空——全空单元格行（|  |  |）与
                // 单短横占位行（| - | - |）是数据行，误吞会破坏往返幂等
                const cells = body.split('|').map((c) => c.trim());
                const sepCell = (c: string) => /^:?-{2,}:?$/.test(c);
                const isSep = cells.some(sepCell) && cells.every((c) => c === '' || sepCell(c));
                if (!isSep) rows.push(parseTableRow(body));
              }
              i++;
            }
            if (isBlockClose(lines[i] ?? '')) i++;
            const b = blockOf('table', attrs);
            b.cells = rows;
            slide.blocks.push(b);
            continue;
          }
          // 未知块：跳过到闭合
          while (i < lines.length && !isBlockClose(lines[i]) && !isSlideFence(lines[i])) i++;
          if (isBlockClose(lines[i] ?? '')) i++;
          continue;
        }
        // $$ 块级公式
        if (t.startsWith('$$')) {
          flushPara();
          flushList();
          let buf = t.slice(2);
          if (buf.trim().endsWith('$$')) {
            buf = buf.trim().slice(0, -2);
            i++;
          } else {
            buf = buf.trim();
            i++;
            const cl: string[] = [];
            while (i < lines.length && !lines[i].includes('$$')) {
              cl.push(lines[i]);
              i++;
            }
            if (i < lines.length) {
              cl.push(lines[i].split('$$')[0]);
              i++;
            }
            buf = [buf, ...cl].join('\n').trim();
          }
          const { latex, label } = extractLabel(buf);
          const b: Block = { id: newId(), type: 'equation', latex };
          if (label) b.label = label;
          slide.blocks.push(b);
          continue;
        }
        // 列表块级出现顺序：紧跟列表项后的独立 {order=N} 行
        const som = t.match(/^\{order=(\d+)\}$/);
        if (som && listItems && listItems.length) {
          const o = parseInt(som[1], 10);
          if (o >= 1) listBlockOrder = o;
          i++;
          continue;
        }
        // 列表（项尾 {order=N} = 该项出现动画顺序）。裸 `-`/`*` 也算空项：
        // 序列化空项产出 `- `（trimEnd 后成 `-`），旧正则要求后随空白会把
        // 空项错判成内容为 `-` 的段落（保存重开即损坏）
        if (/^[-*](\s+|$)/.test(t)) {
          flushPara();
          if (!listItems) listItems = [];
          let it = t.replace(/^[-*]\s*/, '');
          const im = it.match(/\s*\{order=(\d+)\}\s*$/);
          let io: number | undefined;
          if (im) {
            const o = parseInt(im[1], 10);
            if (o >= 1) io = o;
            it = it.slice(0, im.index).trimEnd();
          }
          listItems.push(it);
          listOrders.push(io);
          i++;
          continue;
        }
        flushList();
        para.push(t);
        i++;
      }
      flushPara();
      flushList();
      i++; // 越过闭栏 ::::
      items.push({ kind: 'slide', slide });
      continue;
    }

    // ---- 页外松散内容（容错：自动成页；孤立的 ::: 行跳过） ----
    if (!ln.trim() || BLOCK_OPEN.test(ln.trim())) {
      flushLoose();
      i++;
      continue;
    }
    if (!loose) loose = [];
    loose.push(ln.trim());
    i++;
  }
  flushLoose();

  return { config, items };
}

// ---------- serialize ----------

function serializeSlide(slide: Slide): string {
  const out: string[] = [];
  let head: string;
  if (slide.layout === 'title' || slide.layout === 'toc' || slide.layout === 'end') {
    head = `:::: ${slide.layout}`;
    if (slide.title != null) head += ` title=${q(slide.title)}`;
  } else {
    head = `:::: slide layout=${q(slide.layout)}`;
    if (slide.title != null) head += ` title=${q(slide.title)}`;
    if (slide.ratio != null) head += ` ratio="${slide.ratio}"`;
    if (slide.fontScale != null) head += ` fontScale="${slide.fontScale}"`;
  }
  out.push(head);

  for (const b of slide.blocks) {
    switch (b.type) {
      case 'colmark':
        out.push('::: col');
        break;
      case 'colend':
        out.push('::: /col');
        break;
      case 'paragraph': {
        // 块内 \n（Shift+Enter 硬换行）→ 行尾反斜杠标记；行尾已有的字面反斜杠
        // 先加倍再补标记（共 2k+1 个，恒奇数），与解析侧奇偶判定成对（往返不变）
        const ls = (b.text || '').split('\n').map((l, i, arr) => (
          i < arr.length - 1 ? l + '\\'.repeat(tailBackslashes(l) + 1) : l
        ));
        if (b.order != null) ls[ls.length - 1] += ` {order=${b.order}}`;
        out.push('', ...ls);
        break;
      }
      case 'itemize': {
        // 列表项不支持硬换行（每项一行）：\n 退化为空格，保证 md 可解析；
        // 逐项顺序写项尾 {order=N}；块级顺序写列表下方独立 {order=N} 行
        const ios = b.itemOrders || [];
        out.push('', ...(b.items || []).map((it, i) => '- ' + it.replace(/\n/g, ' ') + (ios[i] != null ? ` {order=${ios[i]}}` : '')));
        if (b.order != null) out.push(`{order=${b.order}}`);
        break;
      }
      case 'equation': {
        const attrs = b.label ? ` label=${q(b.label)}` : '';
        const attrs2 = b.order ? ` order="${b.order}"` : '';
        out.push('', `::: equation${attrs}${attrs2}`, b.latex || '', ':::');
        break;
      }
      case 'annoeq': {
        const attrs = b.label ? ` label=${q(b.label)}` : '';
        const attrs2 = b.order ? ` order="${b.order}"` : '';
        out.push('', `::: annoeq${attrs}${attrs2}`, '%%anno ' + annoToJson(b.anno ?? defaultAnnoState()), b.latex || '', ':::');
        break;
      }
      case 'figure':
      case 'video': {
        const a: string[] = [];
        if (b.src != null) a.push(`src=${q(b.src)}`);
        if (b.width != null) a.push(`width="${b.width}"`);
        if (b.label != null) a.push(`label=${q(b.label)}`);
        if (b.caption != null) a.push(`caption=${q(b.caption)}`);
        if (b.autoplay != null) a.push(`autoplay="${b.autoplay}"`);
        if (b.order != null) a.push(`order="${b.order}"`);
        if (b.pos != null) a.push(`pos="${b.pos.x},${b.pos.y},${b.pos.w}"`);
        out.push('', `::: ${b.type}${attrStr(a)}`, ':::');
        break;
      }
      case 'table': {
        const a: string[] = [];
        if (b.width != null) a.push(`width="${b.width}"`);
        if (b.label != null) a.push(`label=${q(b.label)}`);
        if (b.caption != null) a.push(`caption=${q(b.caption)}`);
        if (b.order != null) a.push(`order="${b.order}"`);
        out.push('', `::: table${attrStr(a)}`);
        const rows = b.cells || [];
        if (rows.length) {
          out.push('| ' + rows[0].map(escCell).join(' | ') + ' |');
          out.push('|' + rows[0].map(() => ' --- ').join('|') + '|');
          for (let r = 1; r < rows.length; r++) {
            out.push('| ' + rows[r].map(escCell).join(' | ') + ' |');
          }
        }
        out.push(':::');
        break;
      }
    }
  }
  if (slide.notes) {
    out.push('', '::: notes', slide.notes, ':::');
  }
  out.push('::::');
  return out.join('\n');
}

export function serializeMarkdown(deck: Deck): string {
  const c = deck.config;
  const fm: Record<string, unknown> = {
    beamerapp: 1,
    title: c.title,
    authors: c.authors,
    affiliations: c.affiliations,
    date: c.date,
    shortTitle: c.shortTitle,
    language: c.language,
    aspect: c.aspect,
    numbering: c.numbering,
    fontZh: c.fontZh,
    fontEn: c.fontEn,
    sectionPages: c.sectionPages,
    fontSize: c.fontSize,
    logo: c.logo || null,
    logoPos: c.logoPos ? `${c.logoPos.x},${c.logoPos.y},${c.logoPos.w}` : null,
    palette: (() => {
      const base: Record<string, unknown> = { ...(c.palette.preset ? { preset: c.palette.preset } : {}) };
      const pv = PRESETS[c.palette.preset ?? ''];
      const same = (a: string | undefined, b: string | undefined) => a === b;
      const isPresetRef = pv
        && same(c.palette.primary.base, pv.primary.base) && same(c.palette.primary.deep, pv.primary.deep)
        && same(c.palette.accent.base, pv.accent.base) && same(c.palette.accent.deep, pv.accent.deep)
        && same(c.palette.emphasis.base, pv.emphasis.base) && same(c.palette.emphasis.deep, pv.emphasis.deep)
        && same(c.palette.text, pv.text) && same(c.palette.textMuted, pv.textMuted)
        && same(c.palette.bg, pv.bg) && same(c.palette.bgAlt, pv.bgAlt);
      if (!isPresetRef) {
        base.primary = { base: c.palette.primary.base, deep: c.palette.primary.deep };
        base.accent = { base: c.palette.accent.base, deep: c.palette.accent.deep };
        base.emphasis = { base: c.palette.emphasis.base, deep: c.palette.emphasis.deep };
        base.text = c.palette.text;
        base.textMuted = c.palette.textMuted;
        base.bg = c.palette.bg;
        base.bgAlt = c.palette.bgAlt;
      }
      return base;
    })(),
  };
  const body = deck.items
    .map((it) => {
      if (it.kind === 'section') {
        const label = it.section.label ? ` {#${it.section.label}}` : '';
        const h = '#'.repeat(it.section.level);
        return `${h} ${it.section.title}${label}`;
      }
      return serializeSlide(it.slide);
    })
    .join('\n\n');
  return `---\n${yaml.dump(fm, { lineWidth: 120, noRefs: true, quotingType: '"' })}---\n\n${body}\n`;
}
