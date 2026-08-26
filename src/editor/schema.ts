// TipTap schema for per-block inline editing（移植自 EditorApp，适配本工程合约）：
// - inlineMath atom（$...$ 键入自动转换）
// - refChip atom（[@eq:x] / [@fig:x] / [@sec:x] / [@tab:x]）
// - colorSpan mark（[文字]{color=角色}）
// - 与 model/inline.ts 的 markdown 源码往返

import { Node, InputRule, Extension, Mark } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
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

// 组合 spec 语法：[文字]{color=x,bg=y}（单/双标记同构，可往返）
const ROLE = 'primary|primaryDeep|accent|accentDeep|emphasis|emphasisDeep|muted|text';
const INLINE_TOKEN_RE = new RegExp(
  '\\$([^$\\n]+)\\$' +                              // 1  行内公式
  '|\\[@(eq|fig|sec|tab):([A-Za-z0-9_:-]+)\\]' +    // 2,3 引用芯片
  '|\\*\\*([^*\\n]+)\\*\\*' +                       // 4  粗体
  '|\\*([^*\\n]+)\\*' +                             // 5  斜体
  '|\\[([^\\]\\n]*)\\]\\{((?:color|bg)=(?:' + ROLE + ')(?:,(?:color|bg)=(?:' + ROLE + '))?)\\}', // 6,7 着色/底色
  'g',
);

interface PmNode {
  type: string;
  text?: string;
  attrs?: Record<string, string>;
  marks?: { type: string; attrs?: Record<string, string> }[];
}

/** 纯文本段入列：\n（块内硬换行）拆为 hardBreak 节点（PM 文本节点不允许 \n） */
function pushText(out: PmNode[], text: string): void {
  const parts = text.split('\n');
  parts.forEach((p, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (p) out.push({ type: 'text', text: p });
  });
}

/** markdown 源码 -> 行内 PM 节点（含 marks） */
function textToInlineNodes(text: string): PmNode[] {
  const out: PmNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_TOKEN_RE.lastIndex = 0;
  while ((m = INLINE_TOKEN_RE.exec(text))) {
    if (m.index > last) pushText(out, text.slice(last, m.index));
    if (m[1] !== undefined) out.push({ type: 'inlineMath', attrs: { latex: m[1] } });
    else if (m[2]) out.push({ type: 'refChip', attrs: { kind: m[2], label: bareRefKey(m[2], m[3]) } });
    else if (m[4] !== undefined) {
      // 粗体 **..**（进入编辑也所见即所得，不再露 ** 源码）
      out.push({ type: 'text', text: m[4], marks: [{ type: 'bold', attrs: {} }] });
    } else if (m[5] !== undefined) {
      out.push({ type: 'text', text: m[5], marks: [{ type: 'italic', attrs: {} }] });
    } else if (m[6] !== undefined) {
      // 组合 spec：color=x,bg=y → 两个 mark（规范序：colorSpan 前、bgSpan 后）
      const marks: { type: string; attrs: Record<string, string> }[] = [];
      for (const part of m[7].split(',')) {
        const [k, v] = part.split('=');
        marks.push({ type: k === 'bg' ? 'bgSpan' : 'colorSpan', attrs: { role: v } });
      }
      out.push({ type: 'text', text: m[6], marks });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) pushText(out, text.slice(last));
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

function inlineNodesToText(nodes: PmNode[] | undefined): string {
  if (!nodes) return '';
  return nodes.map((n) => {
    if (n.type === 'text') {
      let t = n.text ?? '';
      const marks = n.marks ?? [];
      const colorMk = marks.find((mk) => mk.type === 'colorSpan');
      const bgMk = marks.find((mk) => mk.type === 'bgSpan');
      // 文字色+底色合并为单 wrapper（{color=x,bg=y}）——嵌套方括号无法被 tokenizer 解析
      if (colorMk || bgMk) {
        const spec = [
          colorMk ? `color=${colorMk.attrs?.role ?? 'accent'}` : '',
          bgMk ? `bg=${bgMk.attrs?.role ?? 'accent'}` : '',
        ].filter(Boolean).join(',');
        t = `[${t}]{${spec}}`;
      }
      for (const mk of marks) {
        if (mk.type === 'bold') t = `**${t}**`;
        else if (mk.type === 'italic') t = `*${t}*`;
      }
      return t;
    }
    if (n.type === 'inlineMath') return `$${n.attrs?.latex ?? ''}$`;
    if (n.type === 'refChip') return `[@${n.attrs?.kind}:${n.attrs?.label}]`;
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

/** PM doc JSON -> itemize items。
 *  与 docToText 同族防线：粘贴闭合段落/列表级切片会产生多个顶层节点
 *  （bulletList + paragraph 混排），只读首个会静默丢项——
 *  全顶层节点遍历：bulletList 展开各项，paragraph 追加为独立项 */
export function docToItems(doc: { content?: unknown[] }): string[] {
  const out: string[] = [];
  for (const top of (doc?.content ?? []) as { type?: string; content?: unknown[] }[]) {
    if (top.type === 'bulletList') {
      for (const li of top.content ?? []) {
        const l = li as { content?: { type?: string; content?: PmNode[] }[] };
        const p = l.content?.[0];
        out.push(p ? inlineNodesToText(p.content) : '');
      }
    } else if (top.type === 'paragraph') {
      const p = top as { content?: PmNode[] };
      out.push(inlineNodesToText(p.content));
    }
  }
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
