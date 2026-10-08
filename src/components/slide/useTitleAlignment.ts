// Flex centres a line box, not its visible glyphs. Align only the title's paint;
// header/body geometry and the single layout solution remain unchanged.
import { useLayoutEffect, type RefObject } from 'react';

let context: CanvasRenderingContext2D | null = null;
const metrics = new Map<string, TextMetrics>();

export function useTitleAlignment(rootRef: RefObject<HTMLElement>, signature: string): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = root?.querySelector<HTMLElement>('.s-header');
    const title = header?.querySelector<HTMLElement>('.s-title-content');
    if (!root || !header || !title) return;
    let alive = true, frame = 0;
    const align = () => {
      if (!alive) return;
      title.style.removeProperty('--title-shift');
      const scale = root.getBoundingClientRect().width / parseFloat(getComputedStyle(root).width);
      if (!(scale > 0)) return;
      context ??= document.createElement('canvas').getContext('2d');
      if (!context) return;
      const clip = title.getBoundingClientRect();
      let top = Infinity, bottom = -Infinity;
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement;
        if (!parent || !node.data.trim() || parent.closest('.katex-mathml')) continue;
        const style = getComputedStyle(parent);
        if (style.display === 'none') continue;
        const range = document.createRange(); range.selectNodeContents(node);
        let rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (rect.right <= clip.left || rect.left >= clip.right) continue;
        let text = node.data;
        if (rect.left < clip.left || rect.right > clip.right) {
          let offset = 0, start = -1, end = 0;
          for (const char of node.data) {
            range.setStart(node, offset); range.setEnd(node, offset + char.length);
            const part = range.getBoundingClientRect();
            if (part.right > clip.left && part.left < clip.right) { if (start < 0) start = offset; end = offset + char.length; }
            if (part.left >= clip.right) break;
            offset += char.length;
          }
          if (start < 0) continue;
          text = node.data.slice(start, end);
          range.setStart(node, start); range.setEnd(node, end); rect = range.getBoundingClientRect();
        }
        const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const key = font + '\0' + text;
        let measured = metrics.get(key);
        if (!measured) {
          context.font = font; measured = context.measureText(text);
          if (metrics.size >= 512) metrics.clear();
          metrics.set(key, measured);
        }
        const height = measured.fontBoundingBoxAscent + measured.fontBoundingBoxDescent;
        if (!(height > 0)) continue;
        const ratio = rect.height / height;
        const baseline = rect.top + measured.fontBoundingBoxAscent * ratio;
        top = Math.min(top, baseline - measured.actualBoundingBoxAscent * ratio);
        bottom = Math.max(bottom, baseline + measured.actualBoundingBoxDescent * ratio);
      }
      for (const ink of title.querySelectorAll('.katex-html svg, .katex-html .frac-line, .katex-html .sqrt-line')) {
        const rect = ink.getBoundingClientRect();
        if (rect.width && rect.height && rect.right > clip.left && rect.left < clip.right) { top = Math.min(top, rect.top); bottom = Math.max(bottom, rect.bottom); }
      }
      if (!Number.isFinite(top) || bottom <= top) return;
      const box = header.getBoundingClientRect();
      const shift = ((box.top + box.bottom) / 2 - (top + bottom) / 2) / scale;
      title.style.setProperty('--title-shift', `${shift.toFixed(3)}px`);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(align); };
    const loaded = () => { metrics.clear(); align(); };
    align();
    if (document.fonts.status !== 'loaded') void document.fonts.ready.then(() => { if (alive) loaded(); });
    document.fonts.addEventListener('loadingdone', loaded);
    const observer = new MutationObserver(schedule);
    observer.observe(title, { childList: true, characterData: true, subtree: true });
    let width = title.clientWidth;
    const resize = new ResizeObserver(() => {
      const next = title.clientWidth;
      if (next !== width) { width = next; schedule(); }
    });
    resize.observe(title);
    return () => { alive = false; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); document.fonts.removeEventListener('loadingdone', loaded); };
  }, [rootRef, signature]);
}
