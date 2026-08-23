// 静态版面部件：封面作者行 / 目录 / 节分隔页

import { Deck, Section } from '../../model/types';
import { Computed } from '../../model/numbering';

/** 作者上标：张三^1,2; 李四^1 -> 名字 + <sup>；分隔符随语言 */
export function AuthorsLine({ authors, lang }: { authors: string; lang: 'zh' | 'en' }) {
  const names = authors.split(';').map((s) => s.trim()).filter(Boolean);
  const joiner = lang === 'zh' ? '，' : '; ';
  return (
    <>
      {names.map((n, i) => {
        const m = n.match(/\^([\d,\s]+)$/);
        const name = m ? n.slice(0, m.index).trim() : n;
        return (
          <span key={i} className="cover-name">
            {name}
            {m && <sup>{m[1].replace(/\s/g, '')}</sup>}
            {i < names.length - 1 ? joiner : ''}
          </span>
        );
      })}
    </>
  );
}

/** 作者单位（封面作者行下方）：affiliations 用 ; 分隔多个，序号对应作者上标 ^1 ^2。
 *  单个单位且作者无上标 → 无编号一行；多个或有上标 → 上标编号逐行列出 */
export function AffiliationsView({ affiliations, authors }: { affiliations: string; authors: string }) {
  const affs = affiliations.split(';').map((s) => s.trim()).filter(Boolean);
  if (!affs.length) return null;
  const hasSup = /\^[\d,\s]+$/.test(authors);
  const numbered = affs.length > 1 || hasSup;
  return (
    <div className="cover-affs">
      {affs.map((a, i) => (
        <div key={i} className="cover-aff">
          {numbered && <sup className="cover-aff-num">{i + 1}</sup>}
          {a}
        </div>
      ))}
    </div>
  );
}

export function TocView({ deck, computed, onSlideJump }: { deck: Deck; computed: Computed; onSlideJump?: (i: number) => void }) {
  return (
    <div className="toc-list">
      {deck.items.filter((it) => it.kind === 'section').map((it) => {
        if (it.kind !== 'section') return null;
        const s = it.section;
        const num = computed.sectionNum.get(s.id);
        const idx = computed.sectionPageIndex.get(s.id);
        return (
          <a
            key={s.id}
            className={`toc-item toc-l${s.level}`}
            href={idx != null ? `#page-${idx + 1}` : undefined}
            onClick={(e) => {
              if (onSlideJump && idx != null) {
                e.preventDefault();
                onSlideJump(idx);
              }
            }}
          >
            <span className="toc-num">{num}</span>
            <span className="toc-title">{s.title}</span>
          </a>
        );
      })}
    </div>
  );
}

/** 节分隔页：中央渐变卡（固定高度）+ 左侧节号/标题 + 右侧小节列表（随数量缩小字号） */
export function DividerView({
  section, deck, computed, highlight,
}: {
  section: Section;
  deck: Deck;
  computed: Computed;
  highlight?: boolean;
}) {
  const num = computed.sectionNum.get(section.id);
  const items = deck.items;
  const at = items.findIndex((x) => x.kind === 'section' && x.section.id === section.id);
  const subs: Section[] = [];
  for (let i = at + 1; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'section') continue;
    if (it.section.level === 1) break;
    if (it.section.level === 2) subs.push(it.section);
  }
  // 子节字号随数量收缩（容器缩放，子项用 em）
  const subScale = subs.length <= 3 ? 1 : subs.length <= 5 ? 0.85 : subs.length <= 7 ? 0.74 : 0.66;
  return (
    <>
      <div className="divider-ghost">{num}</div>
      <div className={'cover-card divider-card' + (highlight ? ' flash-hl' : '')}>
        <div className="divider-main">
          <div className="cover-kicker">{deck.config.language === 'zh' ? `第 ${num} 部分` : `Part ${num}`}</div>
          <h1 className="cover-title divider-title">{section.title}</h1>
          <div className="cover-bar" />
        </div>
        {subs.length > 0 && (
          <div className="divider-subs" style={subScale !== 1 ? { fontSize: `${Math.round(subScale * 100)}%` } : undefined}>
            {subs.map((s) => (
              <div key={s.id} className="divider-sub">
                <span className="divider-sub-num">{computed.sectionNum.get(s.id)}</span>
                {s.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
