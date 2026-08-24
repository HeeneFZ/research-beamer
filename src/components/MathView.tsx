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

/** 数学排版风格宏：现代科学风格（ISO 80000-2 / GB 3102.11，isomath 家族），
 *  替代 KaTeX 默认的传统 TeX 风格。与传统风格在多类符号上的差异：
 *  - 向量 \vec{x}：黑斜体（\boldsymbol），不再是箭头重音（isomath：\vec -> \vectorsym）
 *  - \mathbf{X}：并入黑斜体（fixmath：ISO 粗体 = 粗斜体，向量/矩阵不使用正体粗体）
 *  - 大写希腊字母：斜体（\Gamma -> \varGamma 等 11 个；TeX 默认大写希腊正体）
 *  常数 e/i、微分 d 的正体化属语义信息（同一字形可作变量），词法层无法判别，
 *  仍按显式 \mathrm{e}/\mathrm{d} 书写（KaTeX 亦无正体小写希腊字形，π 无法正体化）。
 *  每次 render 传浅拷贝，防公式内 \gdef 写入共享对象。 */
export const MATH_STYLE_MACROS: Record<string, string> = {
  '\\vec': '\\boldsymbol',
  '\\mathbf': '\\boldsymbol',
  // 大写希腊直达 \mathit{字面字符} 终止形态——不可写 \varGamma：KaTeX 内置
  // \varGamma 即 \mathit{\Gamma}，会回引本宏形成 \Gamma→\varGamma→\Gamma 无限循环
  '\\Gamma': '\\mathit{Γ}',
  '\\Delta': '\\mathit{Δ}',
  '\\Theta': '\\mathit{Θ}',
  '\\Lambda': '\\mathit{Λ}',
  '\\Xi': '\\mathit{Ξ}',
  '\\Pi': '\\mathit{Π}',
  '\\Sigma': '\\mathit{Σ}',
  '\\Upsilon': '\\mathit{Υ}',
  '\\Phi': '\\mathit{Φ}',
  '\\Psi': '\\mathit{Ψ}',
  '\\Omega': '\\mathit{Ω}',
};

export function katexHtml(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false, macros: { ...MATH_STYLE_MACROS } });
}

/** 行内公式（text 模式，不弹块级 margin） */
export function InlineMath({ latex, palette }: { latex: string; palette: Palette }) {
  const html = useMemo(() => katexHtml(preprocessMath(latex, palette).tex, false), [latex, palette]);
  return <span className="imath" dangerouslySetInnerHTML={{ __html: html }} />;
}
