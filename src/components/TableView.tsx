// 三线表（booktabs 风格）
// width = 文本区宽度比例（与图片同一心智模型：字体恒为正文大小、列宽自动分配、行高自动；
// 非位图式整体缩放——否则字号与正文脱节）。编辑态左右缘拖拽热区直接调宽。

import { useRef } from 'react';
import { Block, Palette } from '../model/types';
import { Computed } from '../model/numbering';
import { InlineText } from './InlineText';
import { EdgeResizeHandles } from './FigureView';

export function TableView({
  block, computed, lang, palette, onRef, onWidthChange,
}: {
  block: Block;
  computed: Computed;
  lang: 'zh' | 'en';
  palette: Palette;
  onRef?: (label: string) => void;
  onWidthChange?: (w: number) => void;
}) {
  const tblRef = useRef<HTMLDivElement | null>(null);
  const rows = block.cells || [];
  if (!rows.length) return null;
  const num = computed.tableNum.get(block.id);
  // 缺省 100%（占满所在栏/文本区）；显式 width 经弹窗输入或边缘拖拽设定
  const w = block.width != null ? `${Math.round(block.width * 100)}%` : '100%';
  return (
    <div className="tbl" style={{ width: w }} ref={(el) => { tblRef.current = el; }}>
      {block.caption != null && (
        <div className="tbl-caption">
          {num && <span className="cap-num">{lang === 'zh' ? `表 ${num}` : `Table ${num}`}</span>}
          <InlineText text={block.caption} computed={computed} lang={lang} palette={palette} onRef={onRef} />
        </div>
      )}
      <table className="three-line">
        <thead>
          <tr>
            {rows[0].map((c, j) => (
              <th key={j}><InlineText text={c} computed={computed} lang={lang} palette={palette} onRef={onRef} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}><InlineText text={c} computed={computed} lang={lang} palette={palette} onRef={onRef} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {onWidthChange && <EdgeResizeHandles hostRef={tblRef} block={block} onWidthChange={onWidthChange} />}
    </div>
  );
}
