// 统一「返回跳转」输入层（编辑器窗口与放映窗口共用）：
// Alt+←、Backspace（非输入焦点时）、鼠标后退侧键（button 3）。
// 输入控件/弹层聚焦时跳过，防止与文本删除、弹窗交互冲突。

import { useEffect } from 'react';

const GUARD = 'input, textarea, .ProseMirror, .modal-mask, .lb-overlay';

const guarded = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && !!t.closest(GUARD);

/** 键盘事件的 target 是焦点元素（常为 body）而非浮层本身——closest 守卫对键盘失效，
 *  需按 DOM 存在性判断：放大镜/弹窗打开时 Backspace/Alt+← 不得触发页面回跳 */
const overlayOpen = (): boolean =>
  typeof document !== 'undefined' && document.querySelector('.lb-overlay, .modal-mask') != null;

export function useBackNav(onBack: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen()) return;
      if (e.altKey && e.key === 'ArrowLeft') {
        // 与 Backspace 同一守卫：输入焦点（文本框/TipTap/弹层）内的 Alt+← 归编辑语义，
        // 不得触发整 deck 回跳（此前仅 Backspace 有守卫，Alt+← 漏网）
        if (guarded(e.target)) return;
        e.preventDefault();
        onBack();
        return;
      }
      if (e.key === 'Backspace' && !guarded(e.target)) {
        e.preventDefault();
        onBack();
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 || guarded(e.target) || overlayOpen()) return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onBack, active]);
}
