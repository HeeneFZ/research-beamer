// 公式渲染（KaTeX + annotate 图例）——独立模块供 SlideView 与公式浮动编辑器共用

import { useMemo } from 'react';
import { Block, Palette } from '../model/types';
import { Computed } from '../model/numbering';
import { InlineText } from './InlineText';
import { AnnotateLegend, katexHtml, preprocessMath } from './MathView';

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

export function EquationView({
  block, computed, palette, lang, onRef, highlight,
}: {
  block: Block;
  computed: Computed;
  palette: Palette;
  lang: 'zh' | 'en';
  onRef?: (label: string) => void;
  highlight?: boolean;
}) {
  const num = computed.equationNum.get(block.id);
  const { tex, legend } = useMemo(() => preprocessMath(block.latex || '', palette), [block.latex, palette]);
  const html = useMemo(() => katexHtml(tex, true), [tex]);
  return (
    <div className={'eq-outer' + (highlight ? ' flash-hl' : '')}>
      <div className="eq-row">
        <div className="eq-body">
          <div className="eq-disp" dangerouslySetInnerHTML={{ __html: html }} />
          {legend.length > 0 && (
            <div className="eq-legend">
              {legend.map((l: AnnotateLegend, i) => (
                <div key={i} className="eq-legend-item">
                  <span className="eq-legend-mark" data-box={l.box ? '1' : undefined} style={{ color: l.color }}>
                    ({ROMAN[i] ?? i + 1})
                  </span>
                  <InlineText text={l.text} computed={computed} lang={lang} palette={palette} onRef={onRef} />
                </div>
              ))}
            </div>
          )}
        </div>
        {num != null && <div className="eq-num">({num})</div>}
      </div>
    </div>
  );
}
