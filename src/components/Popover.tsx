import { ReactNode, useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnchorRect } from './OrderPicker';

/** Screen-space popup: never changes the slide's geometry or inherits its zoom. */
export function Popover({ anchor, className, children, onClose, role }: {
  anchor: AnchorRect; className: string; children: ReactNode; onClose: () => void; role?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const place = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
      const below = anchor.bottom + 6;
      const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - h - 6);
      setPosition((old) => old?.left === left && old.top === top ? old : { left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest('[data-popover-trigger], .math-float, .ref-picker')) return;
      closeRef.current();
    };
    const escape = (event: KeyboardEvent) => { if (!event.isComposing && event.keyCode !== 229 && event.key === 'Escape') closeRef.current(); };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) closeRef.current();
    };
    window.addEventListener('mousedown', outside);
    window.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      window.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
    };
  }, []);
  return createPortal(
    <div ref={ref} role={role} className={className}
      style={position ?? { left: -9999, top: -9999, visibility: 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>, document.body,
  );
}

export function elementAnchor(element: HTMLElement): AnchorRect {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}
