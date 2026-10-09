// 轻量 LaTeX 编辑器（移植自 EditorApp，逐字保持）：语法高亮（透明 textarea 叠加高亮层）
// + `\` 命令联想（↑↓ 选择，Tab/Enter 补全，Esc 关闭；宿主给回调时 Enter 提交 / Esc 取消）

import React, { useEffect, useRef, useState } from 'react';

const LATEX_COMMANDS = [
  '\\frac', '\\sqrt', '\\sum', '\\prod', '\\int', '\\iint', '\\oint', '\\lim',
  '\\infty', '\\partial', '\\nabla', '\\Delta', '\\Omega', '\\alpha', '\\beta', '\\gamma', '\\delta',
  '\\epsilon', '\\theta', '\\lambda', '\\mu', '\\pi', '\\sigma', '\\phi', '\\varphi', '\\omega',
  '\\times', '\\cdot', '\\pm', '\\mp', '\\leq', '\\geq', '\\neq', '\\approx', '\\equiv', '\\propto',
  '\\in', '\\notin', '\\subset', '\\subseteq', '\\cup', '\\cap', '\\emptyset', '\\forall', '\\exists',
  '\\rightarrow', '\\leftarrow', '\\Rightarrow', '\\Leftarrow', '\\mapsto', '\\to',
  '\\mathrm', '\\mathbf', '\\mathit', '\\mathcal', '\\mathbb', '\\text', '\\textbf', '\\textit',
  '\\overline', '\\underline', '\\hat', '\\bar', '\\vec', '\\dot', '\\ddot', '\\tilde',
  '\\log', '\\ln', '\\exp', '\\sin', '\\cos', '\\tan', '\\min', '\\max', '\\arg', '\\sup', '\\inf',
  '\\left', '\\right', '\\bigg', '\\Big', '\\big', '\\ldots', '\\cdots', '\\vdots', '\\ddots',
  '\\begin', '\\end', '\\mathrm{d}', '\\,', '\\;', '\\!', '\\quad', '\\qquad',
  '\\annotate', '\\textcolor',
];

/** 整体被 $..$ / $$..$$ 包裹的 LaTeX 源 → 去包裹（块级公式编辑窗粘贴/输入场景；
 *  非整体包裹（前后有其它内容）原样返回，不打扰正常编辑） */
export function stripMathDelims(src: string): string {
  const t = src.trim();
  if (t.length > 4 && t.startsWith('$$') && t.endsWith('$$')) return t.slice(2, -2).trim();
  if (t.length > 2 && t.startsWith('$') && t.endsWith('$') && !t.slice(0, 2).startsWith('$$') && !t.slice(-2).endsWith('$$')) {
    return t.slice(1, -1).trim();
  }
  return src;
}
/** latex 源码 → 带高亮 span 的 React 节点 */
function highlightLatex(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(%.*$)|(\\[a-zA-Z]+\.?)|([{}^_&])|(\$\$?)/gm;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    if (m[1] !== undefined) out.push(<span key={k++} className="lx-comment">{m[1]}</span>);
    else if (m[2] !== undefined) out.push(<span key={k++} className="lx-cmd">{m[2]}</span>);
    else if (m[3] !== undefined) out.push(<span key={k++} className="lx-brace">{m[3]}</span>);
    else out.push(<span key={k++} className="lx-delim">{m[4]}</span>);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  out.push('\n'); // 末尾占位，保证高亮层与 textarea 高度一致
  return out;
}

export function LatexEditor({ value, onChange, rows = 5, autoFocus, onSubmit, onCancel }: {
  value: string; onChange: (v: string) => void; rows?: number; autoFocus?: boolean;
  onSubmit?: () => void; onCancel?: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  const [ac, setAc] = useState<{ start: number; list: string[]; idx: number } | null>(null);

  // 高亮层与 textarea 折行对齐：textarea 可用内容宽 = 客户宽 − 滚动条，
  // 高亮层不预留会每行多 ~11px → 折行错位 → 光标与文字错位（曾致行内公式
  // 浮层编辑困难）。滚动条宽度实测注入 padding-right；resize 后再同步
  const syncGutter = () => {
    const ta = taRef.current, hl = hlRef.current;
    if (!ta || !hl) return;
    const gutter = ta.offsetWidth - ta.clientWidth;
    const pad = parseFloat(getComputedStyle(hl).paddingRight) || 0;
    const want = gutter + (parseFloat(getComputedStyle(ta).paddingRight) || 0);
    if (Math.abs(pad - want) > 0.5) hl.style.paddingRight = want + 'px';
  };
  const syncScroll = () => {
    if (taRef.current && hlRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop;
      hlRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  const detect = (v: string, caret: number) => {
    const m = /\\[a-zA-Z]*$/.exec(v.slice(0, caret));
    if (!m) { setAc(null); return; }
    const q = m[0].toLowerCase();
    const list = LATEX_COMMANDS.filter((c) => c.toLowerCase().startsWith(q) && c !== m[0]).slice(0, 8);
    if (list.length === 0) { setAc(null); return; }
    setAc({ start: caret - m[0].length, list, idx: 0 });
  };

  const applyAc = (cmd: string) => {
    const ta = taRef.current!;
    const caret = ta.selectionStart;
    const next = value.slice(0, ac!.start) + cmd + value.slice(caret);
    onChange(next);
    setAc(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ac!.start + cmd.length;
    });
  };
  // 滚动条出现/消失（内容长度、rows、resize 变化）后重对齐高亮层折行
  useEffect(() => {
    syncGutter();
    const ta = taRef.current;
    if (!ta || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(syncGutter);
    ro.observe(ta);
    return () => ro.disconnect();
  });
  return (
    <div className="lx-wrap">
      <pre ref={hlRef} className="lx-hl" aria-hidden>{highlightLatex(value)}</pre>
      <textarea
        ref={taRef}
        className="lx-input"
        rows={rows}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder="\frac{a}{b} = c^2"
        onScroll={syncScroll}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          detect(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onClick={() => setAc(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (ac) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...ac, idx: Math.min(ac.idx + 1, ac.list.length - 1) }); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, idx: Math.max(ac.idx - 1, 0) }); return; }
            if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); applyAc(ac.list[ac.idx]); return; }
            if (e.key === 'Escape') { setAc(null); return; }
          }
          // 联想未打开且宿主提供回调：Enter 提交 / Esc 取消（无回调的宿主保持原生行为）
          if (e.key === 'Enter' && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit(); }
          else if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
        }}
      />
      {ac && (
        <div className="lx-ac">
          {ac.list.map((c, i) => (
            <div key={c} className={`lx-ac-item${i === ac.idx ? ' sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); applyAc(c); }}
              onMouseEnter={() => setAc({ ...ac, idx: i })}>
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
