// Section operations share one + menu. New headings use two levels; old level 3 remains readable.
import { useEffect, useState } from 'react';
import { Section, Slide } from '../../model/types';
import { Computed } from '../../model/numbering';
import { slideOf, useStore } from '../../state/store';
import { InlineText } from '../InlineText';
import { RichFieldEditor } from '../RichFieldEditor';
import { Popover, elementAnchor } from '../Popover';
import type { AnchorRect } from '../OrderPicker';

export function SectionBreadcrumb({ slide, path, computed }: {
  slide: Slide; path: Section[]; computed: Computed;
}) {
  const editing = useStore((s) => s.editing?.slideId === slide.id && s.editing.field === 'section' ? s.editing : null);
  const setEditing = useStore((s) => s.setEditing);
  const config = useStore((s) => s.deck.config);
  const activeEditor = useStore((s) => !s.presenting && s.computed.pages[s.current]?.slide?.id === slide.id);
  const [menu, setMenu] = useState<{ anchor: AnchorRect; section?: Section } | null>(null);
  const [field, setField] = useState<{ anchor: AnchorRect; value: string; session: number; sectionId?: string; level?: 1 | 2 } | null>(null);
  const active = activeEditor && editing?.slideId === slide.id && editing.field === 'section';
  useEffect(() => { if (!activeEditor) { setMenu(null); setField(null); } }, [activeEditor]);
  const zh = config.language === 'zh';
  const name = (level: number) => zh ? level === 1 ? '章节' : level === 2 ? '小节' : '旧三级章节' : level === 1 ? 'section' : level === 2 ? 'subsection' : 'legacy subsection';
  const closeField = () => {
    const current = useStore.getState().editing;
    if (current?.slideId === slide.id && current.field === 'section') setEditing(null);
  };
  const start = (sectionId?: string, level?: 1 | 2, value = '') => {
    if (!menu) return;
    setField({ anchor: menu.anchor, value, session: (field?.session ?? 0) + 1, sectionId, level });
    setEditing({ slideId: slide.id, field: 'section', sectionId, sectionLevel: level });
    setMenu(null);
  };
  const commit = (value: string) => {
    const title = value.trim();
    const state = useStore.getState();
    if (!title || !field || !slideOf(state.deck, slide.id)) return;
    if (field.sectionId) state.renameSection(field.sectionId, title);
    else state.addSectionBefore(slide.id, title, field.level === 2 ? 2 : 1);
  };
  const trigger = (section?: Section) => (
    <button className="s-sec-add" data-popover-trigger aria-label={zh ? `${section ? name(section.level) : '章节'}操作` : 'Section actions'} aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        const anchor = elementAnchor(e.currentTarget);
        setMenu((old) => old && old.section?.id === section?.id ? null : { anchor, section });
      }}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
    </button>
  );
  return (
    <div className="s-sec">
      {!path.length ? <><span className="s-sec-new">{zh ? '未设置章节' : 'No section'}</span>{trigger()}</> : path.map((section, i) => (
        <span key={section.id} className="s-sec-crumb">
          <span className="s-sec-seg">
            <span className="s-sec-num">{computed.sectionNum.get(section.id)}</span>
            <span className={section.level === 1 ? 's-sec-l1' : 's-sec-sub'}><InlineText text={section.title} computed={computed} lang={config.language} palette={config.palette} /></span>
          </span>
          {trigger(section)}
          {i < path.length - 1 && <span className="s-sec-sep">›</span>}
        </span>
      ))}
      {activeEditor && menu && <Popover anchor={menu.anchor} className="sec-menu" role="menu" onClose={() => setMenu(null)}>
        <div className="sec-menu-label">{menu.section ? `${computed.sectionNum.get(menu.section.id)} ${menu.section.title}` : zh ? '章节操作' : 'Section actions'}</div>
        {menu.section && <button className="sec-menu-item" role="menuitem" onClick={() => start(menu.section!.id, undefined, menu.section!.title)}>{zh ? `重命名该${name(menu.section.level)}` : 'Rename'}</button>}
        <button className="sec-menu-item" role="menuitem" onClick={() => start(undefined, menu.section && menu.section.level >= 2 ? 2 : 1)}>
          {zh ? menu.section ? menu.section.level > 2 ? '新建小节（第二级）' : `新建同级${name(menu.section.level)}` : '新建章节' : menu.section ? 'New sibling' : 'New section'}
        </button>
        {menu.section?.level === 1 && <button className="sec-menu-item" role="menuitem" onClick={() => start(undefined, 2)}>{zh ? '新建子级小节' : 'New subsection'}</button>}
      </Popover>}
      {active && field && <Popover anchor={field.anchor} className="field-popover" onClose={closeField}>
        <div className="field-popover-label">{zh ? editing.sectionId ? '重命名章节' : `新建${name(editing.sectionLevel ?? 1)}` : editing.sectionId ? 'Rename section' : 'New section'}</div>
        <RichFieldEditor key={field.session} cls="field-input" value={field.value} placeholder={zh ? '输入名称，Enter 完成' : 'Name; Enter to finish'} onCommit={commit} onDone={closeField} onCancel={closeField} />
      </Popover>}
    </div>
  );
}
