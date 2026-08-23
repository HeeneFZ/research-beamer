// E2E 注释公式块（annoeq）检查：展示渲染（标记框/标注标签/引线 SVG/编号/失锚=0）、
// 缩略胶片渲染、编辑器打开、选中公式文字→浮动条→创建标注点、完成落库、undo 复原。
// 用法：E2E_EVAL="$(cat scripts/e2e-annoeq-check.js)" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  await sleep(2600); // zh_talk 加载

  const state = st.getState();
  const pageIdx = state.computed.pages.findIndex((p) => p.slide && p.slide.blocks.some((b) => b.type === 'annoeq'));
  out.pageFound = pageIdx;
  if (pageIdx < 0) return out;
  state.gotoPage(pageIdx);
  await sleep(1800); // KaTeX + 测量 + 排版扫描

  const s1 = st.getState();
  const page = s1.computed.pages[pageIdx];
  const blk = page.slide.blocks.find((b) => b.type === 'annoeq');
  const anno = blk.anno;
  const expBox = anno.marks.filter((m) => m.type === 'box').length;

  // 1) 展示渲染：标记框 / 标注标签 / 引线 / 箭头
  const boxes = document.querySelectorAll('.editor-canvas .ae-mark-box:not(.plain-preview)').length;
  const labels = document.querySelectorAll('.editor-canvas .ae-ann-label').length;
  const lines = document.querySelectorAll('.editor-canvas .ae-svg polyline').length;
  const heads = document.querySelectorAll('.editor-canvas .ae-svg polygon').length;
  const labelKatex = document.querySelectorAll('.editor-canvas .ae-ann-label .katex').length; // 标注内 $..$ 数学
  out.display = {
    marksTotal: anno.marks.length, annotations: anno.annotations.length, expBox,
    boxes, labels, lines, heads, labelKatex,
    okBoxes: boxes === expBox,
    okLabels: labels === anno.annotations.length,
    okLines: lines >= anno.annotations.length,
    okHeads: heads >= lines,
    okInlineMath: labelKatex >= 2,
  };

  // 2) 失锚 = 0（所有 needle 在渲染文本中定位成功；失锚会少画框/线）
  out.allAnchored = { boxes, labels, ok: boxes === expBox && labels === anno.annotations.length };

  // 3) 编号与引用：annoeq 与 equation 共序列；标签可查
  const num = s1.computed.equationNum.get(blk.id);
  const numByLabel = s1.computed.equationNumByLabel.get(blk.label);
  const numText = document.querySelector('.editor-canvas .ae-outer .eq-num')?.textContent || '';
  out.numbering = { num, numByLabel, numText, ok: num === numByLabel && numText === `(${num})` };

  // 4) 标注外扩：wrap padding 吸收上下引线（上下 padding > 基线值）
  const wrap = document.querySelector('.editor-canvas .ae-wrap');
  const pad = wrap ? getComputedStyle(wrap).padding : '';
  const [pt, pr, pb, pl] = pad.split(' ').map((v) => parseFloat(v));
  out.wrapPadding = { pt, pb, pl, pr, ok: pt > 2 && pb > 2 };

  // 5) 胶片缩略图同渲染（多模式共用组件）
  const thumbLabels = document.querySelectorAll('.filmstrip .ae-ann-label').length;
  out.thumb = { labels: thumbLabels, ok: thumbLabels >= anno.annotations.length };

  // 6) 编辑器：打开 → 面板卡片 → 选中文字创建标注点 → 完成落库 → undo 复原
  st.getState().setEditing({ slideId: page.slide.id, blockId: blk.id });
  await sleep(900);
  const modal = document.querySelector('.modal-anno');
  out.editor = { open: !!modal };
  if (modal) {
    const markCards0 = modal.querySelectorAll('.ae-pane:nth-of-type(2) .ae-card').length;
    const annCards = modal.querySelectorAll('.ae-pane:nth-of-type(3) .ae-card').length;
    out.editor.panels = { markCards0, annCards, ok: markCards0 === anno.marks.length && annCards === anno.annotations.length };

    // 选中公式文字（首个含 'p' 的文本节点）→ mouseup → 浮动条 → 高亮框
    const eqn = modal.querySelector('.ae-eqn');
    let node = null, idx = -1;
    const walker = document.createTreeWalker(eqn, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.parentElement.closest('.katex-mathml')) continue;
      const i = n.data.indexOf('p');
      if (i >= 0) { node = n; idx = i; break; }
    }
    if (node) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const r = document.createRange();
      r.setStart(node, idx); r.setEnd(node, idx + 1);
      sel.addRange(r);
      eqn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await sleep(150);
      const bar = modal.querySelector('.ae-selbar');
      out.editor.selbar = { shown: !!bar };
      const btn = bar && [...bar.querySelectorAll('button')].find((b) => b.textContent === '高亮框');
      if (btn) {
        btn.click();
        await sleep(400);
        const markCards1 = modal.querySelectorAll('.ae-pane:nth-of-type(2) .ae-card').length;
        out.editor.createMark = { markCards1, ok: markCards1 === markCards0 + 1 };
      }
      sel.removeAllRanges();
    } else out.editor.selbar = { error: 'no text node with p' };

    // $$..$$ 自动解包裹（第卅一轮）：LatexEditor 输入整体包裹源 → onChange 去包裹
    const ta = modal.querySelector('.lx-input');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '$$E=mc^2$$');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      out.editor.unwrap = { value: ta.value, ok: ta.value.trim() === 'E=mc^2' };
      setter.call(ta, '$$\\mathcal{O}(p\\kappa)$$ + y');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      out.editor.unwrapPartial = { ok: ta.value.includes('$$') }; // 非整体包裹不动
      setter.call(ta, blk.latex);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(400);
    }

    // 画布滚轮 = 预览字号（第卅一轮）
    const canvasEl = modal.querySelector('.ae-canvas');
    const fs0 = document.querySelector('.modal-anno .ae-eqn') && getComputedStyle(modal.querySelector('.ae-eqn')).fontSize;
    canvasEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    await sleep(300);
    const fs1 = getComputedStyle(modal.querySelector('.ae-eqn')).fontSize;
    out.editor.wheelZoom = { fs0, fs1, ok: parseFloat(fs1) === parseFloat(fs0) + 1 };
    canvasEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    await sleep(300);

    // 双击高亮框 → 直接新建标注（第卅一轮）
    let annCount = modal.querySelectorAll('.ae-pane:nth-of-type(3) .ae-card').length;
    const box = modal.querySelector('.ae-mark-box:not(.plain-preview)');
    if (box) {
      box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(400);
      annCount = modal.querySelectorAll('.ae-pane:nth-of-type(3) .ae-card').length;
      out.editor.dblclickAnnotate = { ok: annCount >= anno.annotations.length + 1 };
    }

    // 键盘快捷（第卅一轮）：方向键微调选中标注 yshift；Delete 删除
    const annCard = modal.querySelectorAll('.ae-pane:nth-of-type(3) .ae-card')[0];
    if (annCard) {
      annCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(250);
      const yInput = [...annCard.querySelectorAll('input[type=number]')].find((i) => i.closest('label') && /yshift/.test(i.closest('label').textContent || ''));
      const y0 = yInput ? parseFloat(yInput.value) : null;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await sleep(300);
      const y1 = yInput ? parseFloat(yInput.value) : null;
      out.editor.arrowNudge = { y0, y1, ok: y0 != null && y1 === y0 + 0.25 };
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await sleep(400);
      const annAfterDel = modal.querySelectorAll('.ae-pane:nth-of-type(3) .ae-card').length;
      out.editor.deleteKey = { annCount, annAfterDel, ok: annAfterDel === annCount - 1 };
    }
    // 完成 → 落库
    const doneBtn = [...modal.querySelectorAll('.modal-actions button')].find((b) => b.textContent === '完成');
    doneBtn && doneBtn.click();
    await sleep(600);
    const s2 = st.getState();
    const blk2 = s2.deck.items
      .filter((x) => x.kind === 'slide').map((x) => x.slide)
      .flatMap((sl) => sl.blocks).find((b) => b.id === blk.id);
    out.editor.persist = { marks: blk2.anno.marks.length, ok: blk2.anno.marks.length === anno.marks.length + 1 };
    // undo 复原
    s2.undo();
    await sleep(400);
    const s3 = st.getState();
    const blk3 = s3.deck.items
      .filter((x) => x.kind === 'slide').map((x) => x.slide)
      .flatMap((sl) => sl.blocks).find((b) => b.id === blk.id);
    out.editor.undo = { marks: blk3.anno.marks.length, ok: blk3.anno.marks.length === anno.marks.length };
  }

  // 8) 放映窗（独立 BrowserWindow）同组件渲染：留给 E2E_EVAL_PRESENT（e2e-annoeq-present.js）
  await st.getState().startPresent();
  await sleep(1500);

  return out;
})()
