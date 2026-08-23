// E2E 功能检查（第十五轮新增）：块级/行内公式等大、图边缘拖拽调宽、封面可编辑、
// 硬换行展示态 <br>、自动保存胶囊切换。
// 用法：E2E_EVAL="$(cat scripts/e2e-features-check.js)" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  await sleep(2600); // zh_talk 加载

  // 1) 块级公式与行内公式字号一致（KaTeX 三种语境统一 1em）
  st.getState().gotoPage(6); // 系统整体架构：$$ 块级 + $..$ 行内
  await sleep(1600);
  const disp = document.querySelector('.editor-canvas .eq-disp .katex');
  const inl = document.querySelector('.editor-canvas .imath .katex');
  out.mathSize = disp && inl ? {
    disp: parseFloat(getComputedStyle(disp).fontSize),
    inl: parseFloat(getComputedStyle(inl).fontSize),
    equal: Math.abs(parseFloat(getComputedStyle(disp).fontSize) - parseFloat(getComputedStyle(inl).fontSize)) < 0.5,
  } : { error: 'katex not found', disp: !!disp, inl: !!inl };

  // 2) 图边缘拖拽调宽（twoCol 页右栏 1.jpg，显式 width 0.92）
  st.getState().gotoPage(9);
  await sleep(1600);
  const slide9 = st.getState().computed.pages[9].slide;
  const figEl = document.querySelector('.editor-canvas .fig');
  const bid = figEl && figEl.closest('[data-bid]').getAttribute('data-bid');
  const blk = slide9.blocks.find((b) => b.id === bid);
  const w0 = blk.width;
  const rz = figEl && figEl.querySelector('.edge-rz-r');
  if (rz) {
    const r = rz.getBoundingClientRect();
    const base = { bubbles: true, button: 0, clientX: r.left + 4, clientY: r.top + r.height / 2 };
    rz.dispatchEvent(new MouseEvent('mousedown', base));
    window.dispatchEvent(new MouseEvent('mousemove', { ...base, clientX: base.clientX - 120 }));
    window.dispatchEvent(new MouseEvent('mouseup', base));
    await sleep(400);
  }
  const w1 = (() => {
    // 注意从最新 store 读（updateBlock 是深克隆，旧引用拿不到新值）
    const d = st.getState().deck;
    const sl = d.items.find((x) => x.kind === 'slide' && x.slide.id === slide9.id);
    return sl && sl.kind === 'slide' ? sl.slide.blocks.find((b) => b.id === bid)?.width : undefined;
  })();
  out.edgeDrag = { w0, w1, changed: w1 != null && w0 != null && Math.abs(w1 - w0) > 0.01 };
  // 复原
  if (w0 != null) st.getState().updateBlock(slide9.id, bid, { width: w0 });

  // 3) 封面标题可编辑（点击 → 输入 → Enter 落 front-matter）
  st.getState().gotoPage(0);
  await sleep(700);
  const coverTitle = document.querySelector('.editor-canvas .cover-title');
  coverTitle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const input = document.querySelector('.editor-canvas .cover-title input.cover-edit');
  out.coverEdit = { editorShown: !!input };
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'E2E 新标题');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(300);
    out.coverEdit.titleAfter = st.getState().deck.config.title;
    st.getState().setConfig({ title: '基于深度学习的科技文本自动排版方法' });
  }

  // 4) 硬换行：段落文本含 \n 时展示态渲染 <br>
  st.getState().gotoPage(3);
  await sleep(900);
  const pg4 = st.getState().computed.pages[3].slide;
  const paraBlock = pg4.blocks.find((b) => b.type === 'paragraph');
  const text0 = paraBlock.text;
  st.getState().updateBlock(pg4.id, paraBlock.id, { text: '第一行E2E\n第二行E2E' });
  await sleep(700);
  const brs = document.querySelectorAll('.editor-canvas .para br').length;
  out.hardBreak = { brs, ok: brs >= 1 };
  st.getState().updateBlock(pg4.id, paraBlock.id, { text: text0 });

  // 5) 自动保存胶囊
  const pill = document.querySelector('.save-pill');
  const as0 = st.getState().autoSave;
  if (pill) {
    pill.click();
    await sleep(150);
  }
  const as1 = st.getState().autoSave;
  if (pill) {
    pill.click();
    await sleep(150);
  }
  out.autosavePill = { exists: !!pill, as0, as1, toggled: as0 !== as1, restored: st.getState().autoSave === as0 };

  // 6) 块间距对称性（第十六轮修复）：zh 第 11 页（段落→图→段落→图），
  //    图块的段前间距与段后间距应相等（统一「段前 0+段后 --gap-para」约定）
  st.getState().gotoPage(10);
  await sleep(1800);
  const blocks11 = [...document.querySelectorAll('.editor-canvas .s-body .fblock')];
  const rects = blocks11.map((b) => {
    const r = b.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });
  const gaps = [];
  for (let k = 0; k < rects.length - 1; k++) gaps.push(Math.round((rects[k + 1].top - rects[k].bottom) * 10) / 10);
  const gMin = Math.min(...gaps);
  const gMax = Math.max(...gaps);
  out.gapSymmetry = { gaps, maxDiff: Math.round((gMax - gMin) * 10) / 10, ok: gMax - gMin < 3 };

  // 7) 封面单位展开（去顶部 kicker、作者下方编号逐行）+ 编辑双虚线框守卫
  st.getState().gotoPage(0);
  await sleep(700);
  const affs = [...document.querySelectorAll('.editor-canvas .title-card .cover-aff')].map((x) => x.textContent.trim());
  out.coverAffs = {
    affs,
    kickerGone: !document.querySelector('.editor-canvas .title-card .cover-kicker'),
    numberedTwo: affs.length === 2 && affs[0].startsWith('1') && affs[1].startsWith('2'),
  };
  // 点击封面标题 → 编辑器打开时父级 outline 让位给输入框虚线边（否则双虚线框）
  const ct = document.querySelector('.editor-canvas .cover-title');
  ct.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const editingTitle = document.querySelector('.editor-canvas .cover-title');
  const outlineStyle = editingTitle ? getComputedStyle(editingTitle).outlineStyle : 'missing';
  const inputOpen = !!document.querySelector('.editor-canvas .cover-title input.cover-edit');
  out.singleFrame = { inputOpen, outlineStyle, ok: inputOpen && outlineStyle === 'none' };
  const openInput = document.querySelector('.editor-canvas .cover-title input.cover-edit');
  if (openInput) openInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(250);

  // 8) 尾页副标题（shortTitle）可编辑
  st.getState().gotoPage(st.getState().computed.pages.length - 1);
  await sleep(700);
  const sub = document.querySelector('.editor-canvas .cover-end-sub');
  if (sub) sub.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const subInput = document.querySelector('.editor-canvas .cover-end-sub input.cover-edit');
  out.endSubEdit = { shown: !!subInput };
  if (subInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(subInput, 'E2E 副标题');
    subInput.dispatchEvent(new Event('input', { bubbles: true }));
    subInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(300);
    out.endSubEdit.after = st.getState().deck.config.shortTitle;
    st.getState().setConfig({ shortTitle: '深度学习自动排版' });
  }

  // 9) 表格边缘拖拽调宽（twoCol 页右栏表格，原无 width → 拖出显式宽度）
  st.getState().gotoPage(9);
  await sleep(1600);
  const slideT = st.getState().computed.pages[9].slide;
  const tblEl = document.querySelector('.editor-canvas .tbl');
  const tbid = tblEl && tblEl.closest('[data-bid]').getAttribute('data-bid');
  const tb0 = slideT.blocks.find((b) => b.id === tbid)?.width;
  const trz = tblEl && tblEl.querySelector('.edge-rz-r');
  if (trz) {
    const r = trz.getBoundingClientRect();
    const base = { bubbles: true, button: 0, clientX: r.left + 4, clientY: r.top + r.height / 2 };
    trz.dispatchEvent(new MouseEvent('mousedown', base));
    window.dispatchEvent(new MouseEvent('mousemove', { ...base, clientX: base.clientX - 100 }));
    window.dispatchEvent(new MouseEvent('mouseup', base));
    await sleep(400);
  }
  const tb1 = (() => {
    const d = st.getState().deck;
    const sl = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideT.id);
    return sl && sl.kind === 'slide' ? sl.slide.blocks.find((b) => b.id === tbid)?.width : undefined;
  })();
  out.tableDrag = { tb0: tb0 ?? 'auto', tb1, changed: typeof tb1 === 'number' && tb1 < (tb0 ?? 1) };
  if (typeof tb1 === 'number') st.getState().updateBlock(slideT.id, tbid, { width: undefined });

  // 10) Lightbox 题注（固定视口底部，不随图缩放）
  const folder0 = st.getState().folder;
  st.getState().setLightbox({ abs: folder0 + '/media/1.jpg', ext: 'jpg', caption: '系统架构与排版流程示意（位图）' });
  await sleep(500);
  const lbCap = document.querySelector('.lb-caption');
  out.lightboxCaption = { shown: !!lbCap, text: lbCap ? lbCap.textContent.slice(0, 10) : null };
  st.getState().setLightbox(null);

  return out;
})()
