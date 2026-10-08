// TipTap schema for per-block inline editing（移植自 EditorApp，适配本工程合约）：
// - inlineMath atom（$...$ 键入自动转换）
// - refChip atom（[@eq:x] / [@fig:x] / [@sec:x] / [@tab:x]）
// - colorSpan mark（[文字]{color=角色}）
// - 与 model/inline.ts 的 markdown 源码往返

import { Node, InputRule, Extension, Mark } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Fragment, Slice, Node as PMNode } from '@tiptap/pm/model';
import { InlineToken, tokenizeInline } from '../model/inline';
import { InlineMathView, RefChipView } from '../components/ChipViews';

// ---------- custom nodes ----------

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-inline-math]', getAttrs: (el) => ({ latex: (el as HTMLElement).dataset.latex ?? '' }) }],
  renderHTML({ node }) {
    return ['span', { 'data-inline-math': '', 'data-latex': node.attrs.latex }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  },
  addInputRules() {
    const toMath = (latex: string) => ({ type: 'inlineMath', attrs: { latex } });
    return [
      // $$ 或 ￥￥（中文 IME 全角）立即生成空行内公式
      new InputRule({
        find: /\$\$$/,
        handler: ({ range, chain }) => {
          chain().insertContentAt(range, toMath('')).run();
        },
      }),
      new InputRule({
        find: /￥￥$/,
        handler: ({ range, chain }) => {
          chain().insertContentAt(range, toMath('')).run();
        },
      }),
      new InputRule({
        find: /\$([^$\n]+)\$$/,
        handler: ({ range, match, chain }) => {
          chain().insertContentAt(range, toMath(match[1])).run();
        },
      }),
      new InputRule({
        find: /￥([^￥\n]+)￥$/,
        handler: ({ range, match, chain }) => {
          chain().insertContentAt(range, toMath(match[1])).run();
        },
      }),
    ];
  },
});
/** 芯片 label 统一为裸键：剥除与 kind 重复的前缀（'eq:pos' → 'pos'）。
 *  芯片序列化写 [@kind:label]，label 必须不带前缀——picker/粘贴/历史脏文本
 *  三条入口统一经此归一，杜绝 [@eq:eq:x] 双重前缀再次落盘 */
export function bareRefKey(kind: string, label: string): string {
  return label.startsWith(kind + ':') ? label.slice(kind.length + 1) : label;
}

export const RefChip = Node.create({
  name: 'refChip',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ kind: { default: 'eq' }, label: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-ref-chip]', getAttrs: (el) => {
    const d = (el as HTMLElement).dataset;
    return { kind: d.kind ?? 'eq', label: d.label ?? '' };
  } }],
  renderHTML({ node }) {
    return ['span', { 'data-ref-chip': '', 'data-kind': node.attrs.kind, 'data-label': node.attrs.label }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RefChipView);
  },
  addInputRules() {
    return [
      // 完整输入 [@eq:x] 自动转芯片（label 归一为裸键，双重前缀同样剥除）
      new InputRule({
        find: /\[@(eq|fig|sec|tab):([A-Za-z0-9_:-]+)\]$/,
        handler: ({ range, match, chain }) => {
          chain().insertContentAt(range, { type: 'refChip', attrs: { kind: match[1], label: bareRefKey(match[1], match[2]) } }).run();
        },
      }),
    ];
  },
});

// ---------- colorSpan mark ----------

export const ColorSpan = Mark.create({
  name: 'colorSpan',
  addAttributes: () => ({ role: { default: 'accent' } }),
  parseHTML: () => [{ tag: 'span[data-color-role]', getAttrs: (el) => ({ role: (el as HTMLElement).dataset.colorRole ?? 'accent' }) }],
  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-color-role': HTMLAttributes.role ?? 'accent' }, 0];
  },
});

/** 底色标记：[文字]{bg=角色}（配色角色浅色底，保证整体配色一致） */
export const BgSpan = Mark.create({
  name: 'bgSpan',
  addAttributes: () => ({ role: { default: 'accent' } }),
  parseHTML: () => [{ tag: 'span[data-bg-role]', getAttrs: (el) => ({ role: (el as HTMLElement).dataset.bgRole ?? 'accent' }) }],
  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-bg-role': HTMLAttributes.role ?? 'accent' }, 0];
  },
});
// ---------- serialization（与 model/inline.ts 合约一致） ----------

// 编辑态解析复用展示态 tokenizer（model/inline.ts 递归下降）——单一语法事实源，
// 编辑所见即展示所得。旧扁平正则的三类漏解析（漏成裸文本、源码直显）：
//   ① span 内容含 \n（硬换行）：[方法一\n（积分）：]{color=primary}——[^\]\n]* 排除换行
//   ② 粗体/斜体与着色嵌套：**[重点]{color=accent}**——bold 先匹配吞掉内层 span
//   ③ 非预设角色名：{color=blue}——旧正则按角色白名单收紧（展示态 [\w-]+ 宽容）

interface PmNode {
  type: string;
  content?: PmNode[];
  text?: string;
  attrs?: Record<string, string>;
  marks?: { type: string; attrs?: Record<string, string> }[];
}
type PmMark = NonNullable<PmNode['marks']>[number];

/** 追加 mark：同类型去重后替换（对齐 PM Mark.addToSet 语义；源码语法
 *  first-]-wins 使同类嵌套不可达，此处为编辑器内重复套用做防御） */
function withMark(marks: PmMark[], mark: PmMark): PmMark[] {
  return [...marks.filter((m) => m.type !== mark.type), mark];
}

/** 纯文本段入列：\n（块内硬换行）拆为 hardBreak 节点（PM 文本节点不允许 \n）；
 *  祖先嵌套累积的 marks 施加到每个文本片段 */
function pushText(out: PmNode[], text: string, marks: PmMark[] = []): void {
  const parts = text.split('\n');
  parts.forEach((p, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (p) out.push(marks.length ? { type: 'text', text: p, marks } : { type: 'text', text: p });
  });
}

/** 展示态令牌流 → 行内 PM 节点（递归下降，mark 沿嵌套路径累积） */
function tokensToNodes(toks: InlineToken[], marks: PmMark[], out: PmNode[]): void {
  for (const t of toks) {
    switch (t.t) {
      case 'text':
        pushText(out, t.v, marks);
        break;
      case 'math':
        out.push(marks.length ? { type: 'inlineMath', attrs: { latex: t.v }, marks } : { type: 'inlineMath', attrs: { latex: t.v } });
        break;
      case 'ref': {
        // tokenizer 已校验 label 形如 kind:key（含双重前缀自愈剥除）
        const kind = t.label.slice(0, t.label.indexOf(':'));
        out.push(marks.length ? { type: 'refChip', attrs: { kind, label: bareRefKey(kind, t.label) }, marks } : { type: 'refChip', attrs: { kind, label: bareRefKey(kind, t.label) } });
        break;
      }
      case 'color':
        tokensToNodes(t.children, withMark(marks, { type: 'colorSpan', attrs: { role: t.role } }), out);
        break;
      case 'bg':
        tokensToNodes(t.children, withMark(marks, { type: 'bgSpan', attrs: { role: t.role } }), out);
        break;
      case 'bold':
        tokensToNodes(t.children, withMark(marks, { type: 'bold', attrs: {} }), out);
        break;
      case 'italic':
        tokensToNodes(t.children, withMark(marks, { type: 'italic', attrs: {} }), out);
        break;
    }
  }
}

/** markdown 源码 -> 行内 PM 节点（含 marks）——与展示态 InlineText 同一 tokenizer */
function textToInlineNodes(text: string): PmNode[] {
  const out: PmNode[] = [];
  tokensToNodes(tokenizeInline(text), [], out);
  return out;
}

export function textToDoc(text: string): object {
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? textToInlineNodes(text) : undefined }] };
}

export function itemsToDoc(items: string[]): object {
  return {
    type: 'doc',
    content: [{
      type: 'bulletList',
      content: (items.length ? items : ['']).map((t) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: t ? textToInlineNodes(t) : undefined }],
      })),
    }],
  };
}

/** marks → md 包裹：color/bg 合并单 wrapper（{color=x,bg=y}——嵌套方括号无法被
 *  tokenizer 解析），bold/italic 依次外包。文本与原子节点（公式/引用芯片）共用——
 *  原子携带的着色 mark 同样落回 span 语法，往返稳定 */
function wrapMarks(inner: string, marks: PmMark[] | undefined): string {
  let t = inner;
  const ms = marks ?? [];
  const colorMk = ms.find((mk) => mk.type === 'colorSpan');
  const bgMk = ms.find((mk) => mk.type === 'bgSpan');
  if (colorMk || bgMk) {
    const spec = [
      colorMk ? `color=${colorMk.attrs?.role ?? 'accent'}` : '',
      bgMk ? `bg=${bgMk.attrs?.role ?? 'accent'}` : '',
    ].filter(Boolean).join(',');
    t = `[${t}]{${spec}}`;
  }
  for (const mk of ms) {
    if (mk.type === 'bold') t = `**${t}**`;
    else if (mk.type === 'italic') t = `*${t}*`;
  }
  return t;
}

function inlineNodesToText(nodes: PmNode[] | undefined): string {
  if (!nodes) return '';
  return nodes.map((n) => {
    if (n.type === 'text') return wrapMarks(n.text ?? '', n.marks);
    if (n.type === 'inlineMath') {
      const tex = n.attrs?.latex ?? '';
      // span 语法可包裹公式（[$x$]{color=x}），但 latex 含 [ ] 时外层方括号
      // 会被 tokenizer 的 findUnescaped(']') 截断 → 重解析漏垃圾字面量——
      // 此类降级为裸输出（丢 mark，与旧扁平正则行为一致）
      const safe = !/[\[\]\n]/.test(tex);
      return safe ? wrapMarks(`$${tex}$`, n.marks) : `$${tex}$`;
    }
    if (n.type === 'refChip') {
      // 引用芯片不可 span 包裹：[[@eq:x]]{color} 的 ref 分支先于 span 截断
      return `[@${n.attrs?.kind}:${n.attrs?.label}]`;
    }
    // 硬换行（Shift+Enter）→ 块文本内的 \n（md 落盘为行尾反斜杠，见 markdown.ts）
    if (n.type === 'hardBreak') return '\n';
    return '';
  }).join('');
}

/** PM doc JSON -> markdown 源码（段落类块）。
 *  粘贴闭合段落级切片（如整块 Ctrl+C→V）会在段内劈出多个 <p>：
 *  只取第一段会静默丢字（曾致粘贴含公式文本后块只剩劈分首段）——
 *  全段落序列化、以 \n 相连（与 pushText 的 hardBreak→\n 互逆，文本模型单行存储） */
export function docToText(doc: { content?: unknown[] }): string {
  const paras = (doc?.content ?? []) as { content?: PmNode[] }[];
  return paras.map((p) => inlineNodesToText(p.content)).join('\n');
}

/** Markdown 列表为扁平数组；粘贴的嵌套列表及多段项按阅读顺序展开，保全内容。 */
export function docToItems(doc: { content?: unknown[] }): string[] {
  const out: string[] = [];
  const visit = (nodes: PmNode[]) => {
    for (const node of nodes) {
      if (node.type === 'paragraph') out.push(inlineNodesToText(node.content));
      else if (node.type === 'listItem' && !node.content?.length) out.push('');
      else if (node.content) visit(node.content);
    }
  };
  visit((doc?.content ?? []) as PmNode[]);
  return out;
}

export interface BlockKeyHandlers {
  onSplit(before: string, after: string): boolean;
  onBackspaceAtStart(): boolean;
  onArrowUpAtStart(): boolean;
  onArrowDownAtEnd(): boolean;
}

export const BlockKeys = Extension.create<{ handlers: BlockKeyHandlers }>({
  name: 'blockKeys',
  priority: 1000,
  addOptions() {
    return { handlers: {
      onSplit: () => false,
      onBackspaceAtStart: () => false,
      onArrowUpAtStart: () => false,
      onArrowDownAtEnd: () => false,
    } };
  },
  addKeyboardShortcuts() {
    const h = () => this.options.handlers;
    return {
      Tab: () => this.editor.isActive('listItem'),
      'Shift-Tab': () => this.editor.isActive('listItem'),
      Enter: () => {
        const { empty, $from } = this.editor.state.selection;
        if (!empty) return false;
        // 列表块交给原生（新建列表项）
        if (this.editor.state.doc.firstChild?.type.name === 'bulletList') return false;
        // doc.cut 切片 → docToText 序列化。textBetween 对原子节点（行内公式/引用芯片）
        // 返回空串，Enter 分块会把 $...$ 与 [@..] 全部写丢——这是公式消失 bug 的根源
        const doc = this.editor.state.doc;
        const before = docToText(doc.cut(0, $from.pos).toJSON());
        const after = docToText(doc.cut($from.pos, doc.content.size).toJSON());
        return h().onSplit(before, after);
      },
      Backspace: () => {
        const { empty, $from } = this.editor.state.selection;
        // 仅在「光标位于块首」时接管（合并/删空块）；块中/块尾一律交给原生删除。
        // 不能用 pos>2 判断：短块（如仅一个 @）光标在末尾 pos=2，会被误吞删除键
        if (!empty || $from.pos !== 1) return false;
        return h().onBackspaceAtStart();
      },
      ArrowUp: () => {
        const { empty, $from } = this.editor.state.selection;
        if (!empty || $from.pos > 2) return false;
        return h().onArrowUpAtStart();
      },
      ArrowDown: () => {
        const { empty, $to } = this.editor.state.selection;
        if (!empty || $to.pos < this.editor.state.doc.content.size - 1) return false;
        return h().onArrowDownAtEnd();
      },
    };
  },
});

// ---------- 粘贴三态（InlineBlockEditor / RichFieldEditor 共用） ----------

/** TipTap handlePaste 工厂：
 *  ① 本应用内部复制（HTML 含 data-inline-math / data-ref-chip 标记）→ 放行 PM 原生解析
 *    （芯片属性与 marks 全保留）；
 *  ② 外部 KaTeX HTML（展示态页面/渲染网页复制）→ 提取 annotation 的 x-tex 源重建
 *    inlineMath 芯片，杜绝 MathML 文本+源码+渲染文本三截垃圾；
 *  ③ 纯文本（外部编辑器/聊天窗的 LaTeX 源）→ $...$ 片段转芯片（InputRule 只在键入时
 *    触发，粘贴不经过，曾致 $x^2$ 落成乱码文本）；多行处理按 flattenNewlines 二选一：
 *    块编辑器拆 hardBreak（块模型 text 支持换行）/ 单行字段拍平空格（字段存不下换行）。 */
export function makePasteHandler(opts: { flattenNewlines: boolean }) {
  return (view: EditorView, event: ClipboardEvent): boolean => {
    const dt = event.clipboardData;
    const html = dt?.getData('text/html') ?? '';
    const text = dt?.getData('text/plain') ?? '';
    const schema = view.state.schema;
    if (html.includes('data-inline-math') || html.includes('data-ref-chip')) return false;
    const katexSrc: string[] = [];
    if (html.includes('katex') || html.includes('x-tex')) {
      const dom = new DOMParser().parseFromString(html, 'text/html');
      for (const an of dom.querySelectorAll('annotation[encoding="application/x-tex"]')) {
        const src = (an.textContent ?? '').trim();
        if (src) katexSrc.push(src);
      }
    }
    if (katexSrc.length) {
      event.preventDefault();
      const nodes: PMNode[] = [];
      katexSrc.forEach((src) => {
        if (nodes.length) nodes.push(schema.text(' '));
        nodes.push(schema.nodes.inlineMath.create({ latex: src }));
      });
      view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)));
      return true;
    }
    if (!text) return false;
    const hasMath = /\$[^$\n]+\$/.test(text);
    if (!hasMath && !text.includes('\n')) return false;
    event.preventDefault();
    const parts = text.split(/\r?\n/);
    while (parts.length && parts[parts.length - 1] === '') parts.pop();
    const nodes: PMNode[] = [];
    const pushTextWithMath = (s: string) => {
      const re = /\$([^$\n]+)\$/g;
      let last = 0, m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        if (m.index > last) nodes.push(schema.text(s.slice(last, m.index)));
        nodes.push(schema.nodes.inlineMath.create({ latex: m[1] }));
        last = m.index + m[0].length;
      }
      if (last < s.length) nodes.push(schema.text(s.slice(last)));
    };
    if (opts.flattenNewlines) {
      pushTextWithMath(parts.join(' '));
    } else {
      parts.forEach((p, i) => {
        if (i > 0) nodes.push(schema.nodes.hardBreak.create());
        if (p) pushTextWithMath(p);
      });
    }
    if (nodes.length) view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)));
    return true;
  };
}
