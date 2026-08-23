// 当前页演讲稿编辑（底部面板）

import { useEffect, useState } from 'react';
import { editableSlideOf, useStore } from '../state/store';

export function NotesPane() {
  const computed = useStore((s) => s.computed);
  const current = useStore((s) => s.current);
  const updateSlide = useStore((s) => s.updateSlide);

  const page = computed.pages[current];
  const slide = editableSlideOf(page, computed.pages);
  const [text, setText] = useState(slide?.notes || '');

  useEffect(() => {
    // notes 也入依赖：撤销/重做等外部改写 store 后本地同步显示；
    // 打字期间 store notes 不变，不会打断编辑（失焦才提交）
    setText(slide?.notes || '');
  }, [slide?.id, slide?.notes, current]);

  const disabled = !slide;
  return (
    <div className="notes-pane">
      <div className="notes-label">演讲稿{disabled && <span className="dim">（自动页不可编辑）</span>}</div>
      <textarea
        className="notes-input"
        value={text}
        disabled={disabled}
        placeholder={disabled ? '' : '本页演讲稿…（放映时显示在演讲者视图）'}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (slide && (slide.notes || '') !== text) updateSlide(slide.id, { notes: text || undefined });
        }}
      />
    </div>
  );
}
