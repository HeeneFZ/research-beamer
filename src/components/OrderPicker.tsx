// 出现顺序快捷选择器：块右上角/列表项 ⏱ 徽章点击弹出，替代此前的输入弹窗。
// 布局按用户约定：首行 [取消][1][2][3][4]、次行 [5][6][7][8][9]、末行自定义数字输入（Enter 提交）。
// portal 到 body（块在 transform: scale 的画布内，内联渲染会被缩放/裁切），全 px 单位。
// 单开语义：挂载即广播 rb-ordpick 关闭既有实例（点另一徽章=直接换锚点，不叠两层）。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 徽章的 getBoundingClientRect 屏幕坐标快照 */
export interface AnchorRect { left: number; top: number; right: number; bottom: number }

const CLOSE_OTHERS = 'rb-ordpick';

export function OrderPicker({ rect, current, onPick, onClose }: {
  rect: AnchorRect;
  /** 当前顺序（未设置 = undefined） */
  current: number | undefined;
  /** 选定即由调用方提交并关闭；undefined = 取消顺序 */
  onPick: (v: number | undefined) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 挂载后量自身尺寸再定位：右对齐徽章、下方优先、触底翻上（useLayoutEffect 首帧前完成，无可见跳动）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8));
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - 6 - h);
    setPos({ left, top });
  }, [rect]);

  // onClose 经 ref 取最新：effect 只挂一次（挂载语义）——父组件每次重渲都给新闭包，
  // 直接依赖 [onClose] 会让「关广播/挂监听」随无关重渲反复拆装
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // 先广播关闭既有实例，再挂自身监听（否则把自己的关闭信号也听了）
    window.dispatchEvent(new Event(CLOSE_OTHERS));
    const close = () => onCloseRef.current();
    const onOther = () => close();
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // 独占 Esc：不穿透到底层画布/弹窗快捷键
      close();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (ref.current?.contains(t)) return;
      // 徽章交给自身 click 做开/关切换：此处放行，避免「外点先关 → 同徽章 click 又开」的乒乓
      if (t?.closest?.('.ord-badge, .li-ord')) return;
      close();
    };
    const onWheel = (e: WheelEvent) => {
      if (ref.current?.contains(e.target as HTMLElement | null)) return;
      close(); // 画布滚动即关：瞬态浮层不跟随滚动（与块位置脱节比直接关掉更费解）
    };
    window.addEventListener(CLOSE_OTHERS, onOther);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => {
      window.removeEventListener(CLOSE_OTHERS, onOther);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', onWheel, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitInput = () => {
    const o = parseInt(inputRef.current?.value ?? '', 10);
    if (Number.isFinite(o) && o >= 1) onPick(o); // 空/非法不提交（清除走「取消」格），留弹窗供改正
  };

  return createPortal(
    <div
      ref={ref}
      className="ord-picker"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: 'hidden' }}
      // portal 事件沿 React 树上冒：挡住，防触发块根 onClick 误进编辑态
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className={'op-cell op-clear' + (current == null ? ' cur' : '')}
        title="取消顺序（恒显示）"
        onClick={() => onPick(undefined)}
      >取消</button>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
        <button key={n} className={'op-cell' + (current === n ? ' cur' : '')} onClick={() => onPick(n)}>{n}</button>
      ))}
      <input
        ref={inputRef}
        className="op-input"
        type="number"
        min={1}
        step={1}
        placeholder="自定义 ≥1，Enter 确认"
        defaultValue={current != null ? String(current) : ''}
        onKeyDown={(e) => { if (e.key === 'Enter') commitInput(); }}
      />
    </div>,
    document.body,
  );
}
