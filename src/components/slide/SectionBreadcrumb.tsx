// 页眉右侧：节路径面包屑（编辑态）
// 点击段 → 弹出菜单（重命名 / 新建同级 / 新建子节），明确区分「改名」与「新建」；
// 悬停段尾「＋」= 新建子节的快捷方式（level+1，封顶 3）。

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Section, Slide } from '../../model/types';
import { Computed } from '../../model/numbering';
import { useStore } from '../../state/store';

interface SecMenu {
  x: number;
  y: number;
  seg: Section;
}

export function SectionBreadcrumb({ slide, path, computed }: {
  slide: Slide; path: Section[]; computed: Computed;
}) {
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const addSectionBefore = useStore((s) => s.addSectionBefore);
  const renameSection = useStore((s) => s.renameSection);
  const [val, setVal] = useState('');
  const [menu, setMenu] = useState<SecMenu | null>(null);
  const active = editing != null && editing.slideId === slide.id && editing.field === 'section';
  const zh = useStore.getState().deck.config.language !== 'en';

  const commit = () => {
    const t = val.trim();
    if (t && editing) {
      if (editing.sectionId) renameSection(editing.sectionId, t);
      else addSectionBefore(slide.id, t, editing.sectionLevel ?? 1);
    }
    setEditing(null);
  };

  // 菜单点击外部/Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.sec-menu')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const startEdit = (sectionId?: string, sectionLevel?: 1 | 2 | 3, init = '') => {
    setVal(init);
    setEditing({ slideId: slide.id, field: 'section', sectionId, sectionLevel });
    setMenu(null);
  };

  const lvlName = (l: number) => (zh ? (l === 1 ? '章节' : l === 2 ? '小节' : '子小节') : `level-${l}`);

  if (active) {
    return (
      <input
        className="sec-edit"
        autoFocus
        value={val}
        placeholder={editing!.sectionId ? '重命名该节' : '输入新节名称'}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setEditing(null);
        }}
      />
    );
  }
  if (!path.length) {
    return (
      <div
        className="s-sec s-sec-editable s-sec-new"
        title="点击设置本页所属章节"
        onClick={(e) => {
          e.stopPropagation();
          startEdit(undefined, 1);
        }}
      >
        {zh ? '§ 设置章节' : '§ set section'}
      </div>
    );
  }
  return (
    <div className="s-sec" title="页眉右侧：章节路径。点击段弹出操作菜单，悬停 ＋ 快速添加子节">
      {path.map((s, i) => {
        const n = computed.sectionNum.get(s.id);
        const isLast = i === path.length - 1;
        return (
          <span key={s.id} className={'s-sec-crumb' + (isLast ? '' : ' s-sec-dim')}>
            <span
              className="s-sec-seg s-sec-editable"
              title="点击：重命名 / 新建章节"
              onClick={(e) => {
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, seg: s });
              }}
            >
              <span className="s-sec-num">{n}</span>
              <span className={s.level === 1 ? 's-sec-l1' : 's-sec-sub'}>{s.title}</span>
            </span>
            {s.level < 3 && (
              <button
                className="s-sec-add"
                title={zh ? `快速添加${lvlName(s.level + 1)}` : `Add ${lvlName(s.level + 1)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(undefined, (s.level + 1) as 2 | 3);
                }}
              >＋</button>
            )}
            {!isLast && <span className="s-sec-sep">›</span>}
          </span>
        );
      })}
      {menu && createPortal(
        <div
          className="sec-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: menu.y + 8 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="sec-menu-label">
            {zh ? `「${menu.seg.title}」（${lvlName(menu.seg.level)}）` : `"${menu.seg.title}" (${lvlName(menu.seg.level)})`}
          </div>
          <div className="sec-menu-item" onClick={() => startEdit(menu.seg.id, undefined, menu.seg.title)}>
            {zh ? '重命名该节' : 'Rename'}
          </div>
          <div className="sec-menu-item"
            onClick={() => startEdit(undefined, menu.seg.level as 1 | 2 | 3)}>
            {zh ? `在本页前新建同级${lvlName(menu.seg.level)}` : `New sibling ${lvlName(menu.seg.level)} before this page`}
          </div>
          {menu.seg.level < 3 && (
            <div className="sec-menu-item"
              onClick={() => startEdit(undefined, (menu.seg.level + 1) as 2 | 3)}>
              {zh ? `在本页前新建${lvlName(menu.seg.level + 1)}（子级）` : `New child ${lvlName(menu.seg.level + 1)} before this page`}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
