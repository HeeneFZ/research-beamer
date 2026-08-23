// KaTeX 渲染 + \annotate 公式注释预处理
//
// \annotate[role(,box)?]{表达式}{图例说明}
//   -> \textcolor{hex}{\underline{表达式}}（或 \boxed）+ 图例条目 (i)(ii)…
// 另将 \textcolor{role}{..} / \color{role} 中的配色角色名解析为具体 hex。

import katex from 'katex';
import { useMemo } from 'react';
import { Palette } from '../model/types';
import { resolveRole } from '../model/palette';

export interface AnnotateLegend {
  text: string;
  color: string;
  box: boolean;
}

const ROLES = [
  'primary', 'primaryDeep', 'accent', 'accentDeep', 'emphasis', 'emphasisDeep', 'muted', 'text',
];

/** 读 {..} 平衡花括号；pos 处必须是 '{'，返回内容与结束后位置；否则 null */
function readBrace(s: string, pos: number): { content: string; next: number } | null {
  if (s[pos] !== '{') return null;
  let depth = 0;
  for (let i = pos; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return { content: s.slice(pos + 1, i), next: i + 1 };
    }
  }
  return null;
}

export function preprocessMath(latex: string, palette: Palette): { tex: string; legend: AnnotateLegend[] } {
  const legend: AnnotateLegend[] = [];
  let out = '';
  let i = 0;
  while (i < latex.length) {
    const idx = latex.indexOf('\\annotate', i);
    if (idx < 0) {
      out += latex.slice(i);
      break;
    }
    out += latex.slice(i, idx);
    let j = idx + '\\annotate'.length;
    while (j < latex.length && latex[j] === ' ') j++;
    let role = 'accent';
    let box = false;
    if (latex[j] === '[') {
      const close = latex.indexOf(']', j);
      if (close > 0) {
        const parts = latex.slice(j + 1, close).split(',').map((x) => x.trim()).filter(Boolean);
        if (parts.length) role = parts[0];
        box = parts.includes('box');
        j = close + 1;
      }
    }
    while (j < latex.length && latex[j] === ' ') j++;
    const expr = readBrace(latex, j);
    if (!expr) {
      // 语法不完整：原样透传
      out += latex.slice(idx, idx + '\\annotate'.length);
      i = idx + '\\annotate'.length;
      continue;
    }
    let text: string | null = null;
    let next = expr.next;
    while (next < latex.length && latex[next] === ' ') next++;
    const leg = readBrace(latex, next);
    if (leg) {
      text = leg.content.trim();
      next = leg.next;
    }
    const color = resolveRole(palette, role);
    const painted = box
      ? `\\textcolor{${color}}{\\boxed{${expr.content}}}`
      : `\\textcolor{${color}}{\\underline{${expr.content}}}`;
    out += painted;
    if (text) legend.push({ text, color, box });
    i = next;
  }
  // 角色名 -> hex（\textcolor{role} / \color{role}）
  for (const r of ROLES) {
    const hex = resolveRole(palette, r);
    out = out.split(`\\textcolor{${r}}`).join(`\\textcolor{${hex}}`);
    out = out.split(`\\color{${r}}`).join(`\\color{${hex}}`);
  }
  return { tex: out, legend };
}

export function katexHtml(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false });
}

/** 行内公式（text 模式，不弹块级 margin） */
export function InlineMath({ latex, palette }: { latex: string; palette: Palette }) {
  const html = useMemo(() => katexHtml(preprocessMath(latex, palette).tex, false), [latex, palette]);
  return <span className="imath" dangerouslySetInnerHTML={{ __html: html }} />;
}
