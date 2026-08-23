// useBackNav 统一输入层契约（第廿一轮修复：Alt+← 漏输入焦点守卫）
// 焦点在 input/textarea/.ProseMirror 时，Backspace 与 Alt+← 都归编辑语义，
// 不得触发整 deck 的引用跳转返回。

import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useBackNav } from '../src/hooks/useBackNav';

function Probe({ onBack }: { onBack: () => void }) {
  useBackNav(onBack);
  return null;
}

async function mount(onBack: () => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Probe onBack={onBack} />); });
  return {
    unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); },
  };
}

describe('useBackNav 输入焦点守卫', () => {
  it('焦点在 textarea：Backspace 与 Alt+← 均不触发回跳；焦点在空白处两者都触发', async () => {
    let backs = 0;
    const h = await mount(() => backs++);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }));
    expect(backs).toBe(0);
    ta.remove();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }));
    expect(backs).toBe(2);
    await h.unmount();
  });

  it('浮层（.modal-mask/.lb-overlay）存在时键盘回跳被压制；鼠标侧键(button 3) 正常回跳', async () => {
    let backs = 0;
    const h = await mount(() => backs++);
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    document.body.appendChild(mask);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(backs).toBe(0);
    mask.remove();
    document.body.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true }));
    expect(backs).toBe(1);
    await h.unmount();
  });
});
