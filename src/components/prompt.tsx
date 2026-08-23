// 模态输入框：window.prompt 的自绘替代——Electron 渲染进程不支持 prompt()
// （调用即同步抛 "prompt() is not supported."，原生入口在仓内从未真正可用）。
// 复用 modal-mask/modal/txt/modal-actions 样式族；独立 createRoot 挂载——
// 调用方多为菜单/工具栏条目，弹窗状态无须侵入各自组件树。

import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

/** 弹出单行输入框；确认（Enter/确定）resolve 输入串，取消（Esc/✕/遮罩/取消）resolve null */
export function promptText(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return; // Esc（捕获阶段）与按钮点击可能并发，只结算一次
      settled = true;
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<PromptDialog title={title} initial={initial} onDone={done} />);
  });
}

function PromptDialog({ title, initial, onDone }: {
  title: string; initial: string; onDone: (v: string | null) => void;
}) {
  const [v, setV] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const bornAt = useRef(Date.now());
  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); } // 对齐原生 prompt：初始值全选，键入即替换
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // 弹窗独占 Esc：不穿透到底层画布/弹窗的快捷键
      onDone(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone]);
  return (
    // 遮罩 mousedown 关闭：挂载 250ms 内忽略——与 BlockEditors.Modal 同款防误关
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget && Date.now() - bornAt.current > 250) onDone(null); }}>
      <div className="modal">
        <div className="modal-head">
          <span>{title}</span>
          <button className="modal-close" onMouseDown={(e) => e.preventDefault()} onClick={() => onDone(null)}>✕</button>
        </div>
        <div className="modal-body">
          <input
            ref={inputRef}
            className="txt"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onDone(v); }}
          />
          <div className="modal-actions">
            <button onClick={() => onDone(null)}>取消</button>
            <button className="primary" onClick={() => onDone(v)}>确定</button>
          </div>
        </div>
      </div>
    </div>
  );
}
