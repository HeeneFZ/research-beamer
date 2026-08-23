// 行内文本渲染：$..$、[@eq:x]、[文字]{color=角色}、**粗体**、*斜体*

import { useMemo, ReactNode, Fragment } from 'react';
import { InlineToken, tokenizeInline } from '../model/inline';
import { Computed, refDisplay, refPageIndex, refParts } from '../model/numbering';
import { roleColorVar } from '../model/palette';
import { InlineMath } from './MathView';
import { Palette } from '../model/types';

export function InlineText({
  text, computed, lang, palette, onRef,
}: {
  text: string;
  computed: Computed;
  lang: 'zh' | 'en';
  palette: Palette;
  onRef?: (label: string) => void;
}) {
  const tokens = useMemo(() => tokenizeInline(text || ''), [text]);
  return <>{renderTokens(tokens, computed, lang, palette, onRef)}</>;
}

function renderTokens(
  toks: InlineToken[],
  computed: Computed,
  lang: 'zh' | 'en',
  palette: Palette,
  onRef?: (label: string) => void,
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
            {display ?? t.label}
          </a>
        );
      }
      case 'color':
        return (
          <span key={i} style={{ color: roleColorVar(t.role) }}>
            {renderTokens(t.children, computed, lang, palette, onRef)}
          </span>
        );
      case 'bg':
        return (
          <span
            key={i}
            className="bg-span"
            style={{ background: `color-mix(in srgb, ${roleColorVar(t.role)} 24%, transparent)` }}
          >
            {renderTokens(t.children, computed, lang, palette, onRef)}
          </span>
        );
      case 'bold':
        return <strong key={i}>{renderTokens(t.children, computed, lang, palette, onRef)}</strong>;
      case 'italic':
        return <em key={i}>{renderTokens(t.children, computed, lang, palette, onRef)}</em>;
    }
  });
}
