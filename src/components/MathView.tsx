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
  // 残留 \label{..} 剥除（防御层：解析/提交两层已提取，这里兜住直改 latex 的旁路，
  // 避免 KaTeX 把不识别的 \label 渲染成红色错误文本）
  latex = latex.replace(/\\label\{[^}]*\}/g, '');
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
  // \varGamma 即 \mathit{\Gamma}，会回引本宏形成 \Gamma→\varGamma→\Gamma 无限循环。
  // 注意：\mathit 形态在粗体语境（\vec/\boldsymbol）会被 KaTeX 静默丢粗，
  // 由 boldGreekFix 在渲染入口改写为裸字面量补上（见下方）。
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
/** 粗体语境（\vec/\mathbf/\boldsymbol/\bm 参数组）内的大写希腊宏 → 裸字面量。
 *  KaTeX 的 \boldsymbol 对显式字体组（\mathit{Γ} 等）静默丢粗——字体一旦固定即免疫
 *  粗体变体切换；裸字面量则正常加粗（mathbf/Main-Bold）。独立书写仍保持 ISO 斜体
 *  （MATH_STYLE_MACROS 的 \mathit 形态），仅向量语境换成可加粗形态。
 *  var 形式（\varGamma 等）同样替换：显式斜体进粗体组同样丢粗。
 *  应用在三个 KaTeX 入口（katexHtml / engine.annLabelText / engine.annoKatexHtml）。 */
const GREEK_CAP_CHARS: Record<string, string> = {
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
// var 形式更长且含同名子串（\varGamma ⊃ \Gamma）——交替顺序即优先级
const GREEK_RE = /\\var(Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![a-zA-Z])|\\(Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![a-zA-Z])/g;
/** 任一希腊宏出现即命中（快速跳过纯拉丁公式，免去逐字符扫描） */
const GREEK_HINT_RE = /\\(?:var)?(?:Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![a-zA-Z])/;
const BOLD_GROUP_CMDS = ['\\boldsymbol', '\\mathbf', '\\bm', '\\vec'];

const replaceGreekInBold = (s: string): string =>
  s.replace(GREEK_RE, (_m, varName, name) => GREEK_CAP_CHARS[varName ?? name]);

export function boldGreekFix(latex: string): string {
  if (!GREEK_HINT_RE.test(latex)) return latex;
  let out = '';
  let i = 0;
  while (i < latex.length) {
    const rest = latex.slice(i);
    const cmd = BOLD_GROUP_CMDS.find((c) => rest.startsWith(c) && !/[a-zA-Z]/.test(rest[c.length] ?? ''));
    if (cmd) {
      out += cmd;
      i += cmd.length;
      while (i < latex.length && /\s/.test(latex[i])) { out += latex[i]; i++; }
      // 花括号参数组：组内任意深度的希腊宏全部替换（嵌套粗体组一并覆盖）
      if (latex[i] === '{') {
        const br = readBrace(latex, i);
        if (br) {
          out += '{' + replaceGreekInBold(br.content) + '}';
          i = br.next;
          continue;
        }
      } else {
        // 无花括号单记号形式：\vec\Gamma → \vec{Γ}（拉丁单记号 \vec x 不动）
        const m = /^\\(?:var)?(?:Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![a-zA-Z])/.exec(latex.slice(i));
        if (m) {
          out += '{' + replaceGreekInBold(m[0]) + '}';
          i += m[0].length;
          continue;
        }
      }
      continue;
    }
    out += latex[i];
    i++;
  }
  return out;
}

export function katexHtml(tex: string, displayMode: boolean): string {
  return katex.renderToString(boldGreekFix(tex), { displayMode, throwOnError: false, strict: false, macros: { ...MATH_STYLE_MACROS } });
}

/** 行内公式（text 模式，不弹块级 margin） */
export function InlineMath({ latex, palette }: { latex: string; palette: Palette }) {
  const html = useMemo(() => katexHtml(preprocessMath(latex, palette).tex, false), [latex, palette]);
  return <span className="imath" dangerouslySetInnerHTML={{ __html: html }} />;
}
