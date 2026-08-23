// E2E 第二十轮 UX 修复验证（编辑窗）：
// 进出编辑零抖动 / 拼写检查关闭 / 配色 preset 往返（blue 可切回）/ 顺序徽章（块+列表项）/ 双栏页确认
// 用法：npm run build && E2E_EVAL="$(cat scripts/e2e-ux-check.js)" E2E_EVAL_PRESENT="$(cat scripts/e2e-ux-present.js)" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // 0) 双栏页确认：找出含 .cols 的页，量 naive 顺序间距应出现负值（跨栏交错假象）
  const n0 = st.getState().computed.pages.length;
  let colsPage = -1;
  let colsGaps = [];
  for (let i = 0; i < n0; i++) {
    st.getState().gotoPage(i);
    await sleep(700);
    if (document.querySelector('.editor-canvas .cols')) {
      colsPage = i + 1;
      const rects = [...document.querySelectorAll('.editor-canvas .s-body .fblock')].map((b) => b.getBoundingClientRect());
      for (let k = 0; k < rects.length - 1; k++) colsGaps.push(Math.round((rects[k + 1].top - rects[k].bottom) * 10) / 10);
      break;
    }
  }
  out.twoColArtifact = { colsPage, naiveGaps: colsGaps, pass: colsPage > 0 && colsGaps.some((g) => g < 0) };

  // 1) 进出编辑零抖动：第 4 页点击段落进编辑，后续块 tops 位移应全 0
  st.getState().gotoPage(3);
  await sleep(1200);
  const tops = () => [...document.querySelectorAll('.editor-canvas .s-body .fblock')].map((b) => Math.round(b.getBoundingClientRect().top * 100) / 100);
  const tops0 = tops();
  document.querySelector('.editor-canvas .s-body .fblock').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(600);
  const shift = tops().map((t, i) => Math.round((t - tops0[i]) * 100) / 100);
  out.jitterFree = { shift, pass: shift.every((d) => Math.abs(d) <= 0.05) };

  // 2) 拼写检查关闭（contenteditable 与标题输入框）
  const pmSpell = document.querySelector('.editor-canvas .ProseMirror')?.getAttribute('spellcheck');
  out.spellcheckOff = { pm: pmSpell, pass: pmSpell === 'false' };
  st.getState().setEditing(null);
  await sleep(300);

  // 3) 配色 preset 往返：forest-green → academic-blue（blue 可切回）
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'forest-green'));
  if (!sel) return { ...out, paletteRoundTrip: { pass: false, error: 'no palette select' } };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  const pick = async (v) => { setter.call(sel, v); sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(350); };
  await pick('forest-green');
  const g = st.getState().deck.config.palette;
  await pick('academic-blue');
  const b = st.getState().deck.config.palette;
  out.paletteRoundTrip = {
    green: g.preset, greenColor: g.primary.base, blueBack: b.preset, blueColor: b.primary.base, selVal: sel.value,
    pass: g.preset === 'forest-green' && g.primary.base === '#1D7A4F' && b.preset === 'academic-blue' && b.primary.base === '#0F66AD',
  };

  // 4) 顺序徽章：第 4 页段落 order=2 → .ord-badge；某页列表第 2 项 order=1 → .li-ord.set
  const s0 = st.getState();
  const slide4 = s0.computed.pages[3].slide;
  const paraB = slide4.blocks.find((x) => x.type === 'paragraph' && x.text);
  s0.updateBlock(slide4.id, paraB.id, { order: 2 });
  let itSlide = null;
  let itBlock = null;
  let itPage = -1;
  s0.computed.pages.forEach((p, i) => {
    if (itBlock || !p.slide) return;
    const bb = p.slide.blocks.find((x) => x.type === 'itemize' && (x.items || []).length >= 2);
    if (bb) { itSlide = p.slide; itBlock = bb; itPage = i; }
  });
  if (itBlock) {
    const len = itBlock.items.length;
    s0.updateBlock(itSlide.id, itBlock.id, { itemOrders: Array.from({ length: len }, (_, k) => (k === 1 ? 1 : undefined)) });
  }
  await sleep(500);
  st.getState().gotoPage(3);
  await sleep(600);
  const badge = document.querySelector('.editor-canvas .fblock .ord-badge');
  out.blockBadge = { text: badge?.textContent?.trim(), pass: badge?.textContent?.trim() === '2' };
  if (itBlock) {
    st.getState().gotoPage(itPage);
    await sleep(600);
    const liSet = [...document.querySelectorAll('.editor-canvas .li-ord.set')].map((x) => x.textContent.trim());
    const liAll = document.querySelectorAll('.editor-canvas .li-ord').length;
    out.itemBadge = { set: liSet, total: liAll, pass: liSet.length === 1 && liSet[0] === '1' && liAll >= 2 };
  }

  // 5) 浮层快捷键屏蔽（第廿二轮）：放大镜/弹窗打开时全局 Ctrl+Z 不穿透；关闭后恢复
  {
    const dump = () => JSON.stringify(st.getState().deck);
    const s5 = st.getState();
    const sl5 = s5.computed.pages[3].slide;
    const para5 = sl5.blocks.find((b) => b.type === 'paragraph' && b.text != null);
    s5.updateBlock(sl5.id, para5.id, { text: (para5.text || '') + '☆' });
    const before = dump();
    s5.setLightbox({ abs: 'C:/nonexistent-e2e.png', ext: 'png' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const lbOk = dump() === before;
    s5.setLightbox(null);
    const figPg = st.getState().computed.pages.findIndex((p) => p.slide && p.slide.blocks.some((b) => b.type === 'figure'));
    st.getState().gotoPage(figPg);
    await sleep(400);
    const fb = st.getState().computed.pages[figPg].slide.blocks.find((b) => b.type === 'figure');
    st.getState().setEditing({ slideId: st.getState().computed.pages[figPg].slide.id, blockId: fb.id });
    await sleep(300);
    const modalOpen = !!document.querySelector('.modal-mask');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const modalOk = dump() === before;
    st.getState().setEditing(null);
    await sleep(300); // 等 React 卸载 modal-mask
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const resumed = dump() !== before;
    out.shortcutShield = { modalOpen, lbOk, modalOk, resumed, pass: modalOpen && lbOk && modalOk && resumed };
  }

  // 6) 胶片右键菜单外点/Esc 自动关闭（第廿三轮）
  {
    const thumb = document.querySelector('.filmstrip .thumb');
    thumb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(250);
    const opened = !!document.querySelector('.menu-drop.ctx');
    document.querySelector('.editor-canvas').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(250);
    const closedAfterOutside = !document.querySelector('.menu-drop.ctx');
    thumb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(250);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    const closedAfterEsc = !document.querySelector('.menu-drop.ctx');
    out.ctxMenuAutoClose = { opened, closedAfterOutside, closedAfterEsc, pass: opened && closedAfterOutside && closedAfterEsc };
  }

  // 7) 工具栏字号键入不被中途钳制回填；blur 提交目标值（第廿三轮）
  {
    const inp = document.querySelector('.toolbar input[type=number]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const fs0 = st.getState().deck.config.fontSize;
    inp.focus();
    setter.call(inp, '2');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const midConfig = st.getState().deck.config.fontSize; // 修复前被钳成 10 并回填
    const midView = inp.value;
    setter.call(inp, '20');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.blur();
    await sleep(150);
    const finalConfig = st.getState().deck.config.fontSize;
    out.fontSizeTyping = { midConfig, midView, finalConfig, pass: midConfig === fs0 && midView === '2' && finalConfig === 20 };
    st.getState().setConfig({ fontSize: fs0 }); // 还原，不污染后续探针
  }

  // 8) 放映门控接力：回第 4 页（order=2 段落）打开放映，E2E_EVAL_PRESENT 验证隐藏→揭示
  st.getState().gotoPage(3, false);
  await st.getState().startPresent();
  await sleep(3000);
  return out;
})()
