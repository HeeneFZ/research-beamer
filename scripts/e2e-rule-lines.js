// KaTeX 规则线渲染验证（编辑画布 + 缩放 + 晚到公式 + 根号顶线）：
// A. 静态公式：分数线 background 带已接管（border 透明、带高 ≥ 1 设备行对应局部值）
// B. 根号顶线 path 的 vinculum 子路径按 scale 重写（d 含 v{>40} 或保持 40 但 k≈1）
// C. 晚到公式（LaTeX 编辑实时预览注入）同样被 restyle —— 旧 observer 缺口回归门
// D. 画布缩放变化后全量重算（带高随 scale 更新）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const dpr = window.devicePixelRatio || 1;
  st.getState().newProject();
  await sleep(1200);
  const s = st.getState();
  const idx = s.computed.pages.findIndex((p) => p.kind === 'slide' && p.slide?.layout === 'content' && (p.slide?.blocks || []).length === 0);
  st.getState().gotoPage(idx);
  await sleep(500);
  const page = st.getState().computed.pages[st.getState().current];
  const sid = page.slide.id;
  st.getState().insertBlock(sid, null, 'equation', { latex: '\\frac{a+b}{c-d} + \\sqrt{\\frac{x}{y}} + \\overline{m}' });
  await sleep(1000);

  // ---------- A. 分数线 ----------
  const rules = [...document.querySelectorAll('.katex .frac-line')];
  out.fracCount = rules.length;
  const checks = rules.map((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const scale = rect.width / el.offsetWidth || 1;
    const bh = parseFloat(cs.backgroundSize.split(' ')[1]) || 0;
    return {
      borderTransparent: cs.borderBottomColor.includes('0, 0, 0, 0') || cs.borderBottomColor === 'transparent',
      hasBand: cs.backgroundImage.includes('gradient') && bh > 0,
      bandLocalPx: bh,
      scale: Math.round(scale * 100) / 100,
      // 屏幕空间带高 ≥ 1 设备行（floor 语义）
      bandScreenOk: bh * scale * dpr >= 0.99,
    };
  });
  out.fracChecks = checks;
  out.passA = checks.length >= 2 && checks.every((c) => c.borderTransparent && c.hasBand && c.bandScreenOk);

  // ---------- B. 根号顶线 ----------
  const sq = [...document.querySelectorAll('.katex .hide-tail path')].filter((p) => /M\d+ 80\s*h400000v/.test(p.getAttribute('d') || '') || (p.dataset.rsnapVd || '').length > 0);
  out.sqrtCount = sq.length;
  const sqChecks = sq.map((p) => {
    const svg = p.ownerSVGElement;
    const rect = svg.getBoundingClientRect();
    const layoutH = parseFloat(getComputedStyle(svg).height) || 1;
    const scale = rect.height / layoutH;
    const vbH = parseFloat((svg.getAttribute('viewBox') || '0 0 0 1000').split(' ')[3]);
    const d = p.getAttribute('d') || '';
    const m = /M\d+ 80\s*h400000v(\d+)h-400000z/.exec(d);
    const vUnits = m ? parseFloat(m[1]) : 0;
    const bandScreen = (vUnits / vbH) * layoutH * scale;
    return { vUnits, scale: Math.round(scale * 100) / 100, bandScreenPx: bandScreen, screenOk: bandScreen * dpr >= 0.99 };
  });
  out.sqrtChecks = sqChecks;
  out.passB = sqChecks.length >= 1 && sqChecks.every((c) => c.screenOk);

  // ---------- C. 晚到公式（实时预览注入 → observer 自匹配）----------
  const blk = st.getState().computed.pages[st.getState().current].slide.blocks.find((b) => b.type === 'equation');
  st.getState().setEditing({ slideId: sid, blockId: blk.id });
  await sleep(500);
  // LaTeX 编辑器实时预览容器（math-float / 预览区）注入新 KaTeX
  const ta = document.querySelector('.math-float textarea, .latex-ta, textarea');
  if (ta) {
    ta.value = '\\frac{p}{q}';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(800);
  }
  await sleep(400);
  const lateRules = [...document.querySelectorAll('.katex .frac-line')];
  const lateOk = lateRules.map((el) => {
    const cs = getComputedStyle(el);
    return cs.backgroundImage.includes('gradient');
  });
  out.lateRuleTotal = lateRules.length;
  out.lateAllBanded = lateOk.length > 0 && lateOk.every(Boolean);
  out.passC = out.lateAllBanded;

  // ---------- D. 缩放重算 ----------
  const z0 = st.getState().zoom;
  const bandOf = () => {
    const el = document.querySelector('.mode-edit .katex .frac-line');
    return el ? parseFloat(getComputedStyle(el).backgroundSize.split(' ')[1]) : 0;
  };
  const before = bandOf();
  st.getState().setZoom(0.6);
  await sleep(700);
  const after = bandOf();
  out.zoomChangedBand = { before, after };
  out.passD = before > 0 && after > 0 && Math.abs(after - before) > 0.001;
  st.getState().setZoom(z0);

  out.pass = out.passA && out.passB && out.passC && out.passD;
  return out;
})()
