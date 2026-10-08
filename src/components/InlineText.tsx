// 行内文本渲染：$..$、[@eq:x]、[文字]{color=角色}、**粗体**、*斜体*

import { useMemo, ReactNode, Fragment } from 'react';
import { InlineToken, tokenizeInline } from '../model/inline';
import { Computed, refDisplay, refPageIndex, refParts } from '../model/numbering';
import { InlineMath } from './MathView';
import { Palette } from '../model/types';

export function InlineText({
  text, computed, lang, palette, onRef, noRefs,
}: {
  text: string;
  computed: Computed;
  lang: 'zh' | 'en';
  palette: Palette;
  onRef?: (label: string) => void;
  /** 渲染语境本身是 <a>（目录项）时置真：引用芯片降级为纯文本 span——
   *  嵌套 <a> 会被浏览器拆解 DOM，React 更新时 removeChild 崩溃 */
  noRefs?: boolean;
}) {
  const tokens = useMemo(() => tokenizeInline(text || ''), [text]);
  return <>{renderTokens(tokens, computed, lang, palette, onRef, noRefs)}{endsInBreak(tokens) && <br />}</>;
}

// ProseMirror keeps a trailing caret line after a hard break; static text needs it too.
function endsInBreak(tokens: InlineToken[]): boolean {
  const last = tokens[tokens.length - 1];
  if (!last) return false;
  return last.t === 'text' ? last.v.endsWith('\n') : 'children' in last && endsInBreak(last.children);
}

function renderTokens(
  toks: InlineToken[],
  computed: Computed,
  lang: 'zh' | 'en',
  palette: Palette,
  onRef?: (label: string) => void,
  noRefs?: boolean,
): ReactNode[] {
  return toks.map((t, i) => {
    switch (t.t) {
      case 'text':
        // 块文本内的 \n = Shift+Enter 硬换行（编辑态 hardBreak 的展示态对应）
        return (
          <span key={i}>
            {t.v.split('\n').map((seg, j) => (
              <Fragment key={j}>{j > 0 && <br />}{seg}</Fragment>
            ))}
          </span>
        );
      case 'math':
        return <InlineMath key={i} latex={t.v} palette={palette} />;
      case 'ref': {
        const parts = refParts(t.label);
        const display = parts ? refDisplay(parts.kind, parts.key, computed, lang) : null;
        // a > a 嵌套语境（目录项）：降级纯文本，防浏览器拆解 DOM
        if (noRefs) return <span key={i} className="xref-t">{display ?? t.label}</span>;
        const target = refPageIndex(t.label, computed);
        return (
          <a
            key={i}
            className={`xref xref-${parts?.kind ?? 'eq'}${display ? '' : ' xref-missing'} ref-chip`}
            href={target != null ? `#page-${target + 1}` : undefined}
            title={`${t.label} → 点击跳转`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onRef) onRef(t.label);
            }}
          >
            {/* 文字单独包一层 .xref-t：芯片底色在 <a> 上、文字渐变在子层——
                background-clip:text 会吞掉元素自身背景，两者必须分层 */}
            <span className="xref-t">{display ?? t.label}</span>
          </a>
        );
      }
      case 'color':
        return (
          <span key={i} data-color-role={t.role}>
            {renderTokens(t.children, computed, lang, palette, onRef, noRefs)}
          </span>
        );
      case 'bg':
        return (
          <span key={i} className="bg-span" data-bg-role={t.role}>
            {renderTokens(t.children, computed, lang, palette, onRef, noRefs)}
          </span>
        );
      case 'bold':
        return <strong key={i}>{renderTokens(t.children, computed, lang, palette, onRef, noRefs)}</strong>;
      case 'italic':
        return <em key={i}>{renderTokens(t.children, computed, lang, palette, onRef, noRefs)}</em>;
    }
  });
}
