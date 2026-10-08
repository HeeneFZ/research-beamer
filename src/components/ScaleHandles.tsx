import { RefObject, useEffect, useRef } from 'react';

/** Local preview during a drag; one persistent update when the pointer is released. */
export function ScaleHandles({ hostRef, scale, onPreview, onCommit }: {
  hostRef: RefObject<HTMLElement | null>; scale: number;
  onPreview: (scale: number | null) => void; onCommit: (scale: number) => void;
}) {
  const stopRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onPreview, onCommit });
  callbacks.current = { onPreview, onCommit };
  useEffect(() => () => stopRef.current?.(), []);
  const start = (side: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !hostRef.current) return;
    event.preventDefault(); event.stopPropagation(); stopRef.current?.();
    const element = event.currentTarget;
    const width = Math.max(1, hostRef.current.getBoundingClientRect().width);
    const x = event.clientX, initial = scale;
    let value = initial, frame = 0;
    if (event.isTrusted) element.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      value = Math.max(0.5, Math.min(2, Math.round(initial * (1 + side * 2 * (next.clientX - x) / width) * 100) / 100));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; callbacks.current.onPreview(value); });
    };
    const finish = (commit = false) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      cancelAnimationFrame(frame); stopRef.current = null;
      if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (commit && value !== initial) callbacks.current.onCommit(value);
      callbacks.current.onPreview(null);
    };
    const up = (next: PointerEvent) => { if (next.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish();
    const escape = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); finish(); } };
    stopRef.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
  };
  return <>{([-1, 1] as const).map((side) => <button key={side} className={`scale-handle scale-handle-${side < 0 ? 'l' : 'r'}`}
    aria-label="拖动调整公式大小" title="拖动调整公式大小" onPointerDown={start(side)} onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        callbacks.current.onCommit(Math.max(0.5, Math.min(2, Math.round((scale + (event.key === 'ArrowRight' ? 0.05 : -0.05)) * 100) / 100)));
      }
    }} />)}</>;
}
