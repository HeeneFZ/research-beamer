const formulaSelector = '.imath[data-latex]';

function containingFormula(node: Node): HTMLElement | null {
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(formulaSelector) ?? null;
}

/** Displayed KaTeX contains both MathML and visual glyphs. Copy the original source. */
export function copyRenderedMath(event: ClipboardEvent): void {
  const clipboard = event.clipboardData;
  if (!clipboard || event.defaultPrevented) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return;
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;

  const range = selection.getRangeAt(0).cloneRange();
  const first = containingFormula(range.startContainer), last = containingFormula(range.endContainer);
  if (first) range.setStartBefore(first);
  if (last) range.setEndAfter(last);
  const fragment = range.cloneContents();
  const formulas = fragment.querySelectorAll<HTMLElement>(formulaSelector);
  if (!formulas.length) return;
  for (const formula of formulas) {
    formula.classList.remove('imath');
    formula.dataset.inlineMath = '';
    formula.textContent = `$${formula.dataset.latex}$`;
  }

  const copy = document.createElement('div');
  copy.setAttribute('aria-hidden', 'true');
  copy.style.cssText = 'position: fixed; pointer-events: none; left: -100vw; opacity: 0; white-space: pre-wrap';
  copy.append(fragment);
  const html = copy.innerHTML;
  // innerText needs a laid-out fragment to retain hard breaks and paragraph boundaries.
  document.body.append(copy);
  const text = copy.innerText;
  copy.remove();
  event.preventDefault();
  clipboard.setData('text/html', html);
  clipboard.setData('text/plain', text);
}
