// E2E 复现：annoeq 标注含 \sqrt —— 检查 .ae-ann-label 内 sqrt svg 的实际渲染状态
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2500);
  const r = await window.api.readFile('E:/projects/ai/BeamerApp/examples/zh_talk/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/projects/ai/BeamerApp/examples/zh_talk' });
  await sleep(2600);

  const LATEX = '\\boldsymbol{y}=\\boldsymbol{x}+z\\boldsymbol{D}\\left( \\boldsymbol{p}\\left( \\xi \\right) \\right).';
  const ANNO_TEXT = '# Light Prop. $\\boldsymbol{D}\\left( \\boldsymbol{u} \\right) =\\frac{\\lambda \\boldsymbol{u}}{\\sqrt{1-\\lambda ^2|\\boldsymbol{u}|^2}}$';

  const s = st.getState();
  const idx = s.computed.pages.findIndex((p) => p.slide && p.slide.blocks.some((b) => b.type === 'annoeq'));
  if (idx < 0) return { error: 'no annoeq page' };
  const page = s.computed.pages[idx];
  const blk = page.slide.blocks.find((b) => b.type === 'annoeq');
  s.updateBlock(page.slide.id, blk.id, {
    latex: LATEX,
    anno: {
      fontSize: 30, scale: 1.3, shade: 17, equalHeight: true, fboxScale: 0.5,
      annFontScale: 0.5, labelFont: 'auto', paletteIdx: 5,
      marks: [{ id: 'mD', name: 'D', type: 'box', color: '#2A4FC7', needle: 'D', occ: 0 }],
      annotations: [{ id: 'aD', type: 'one', text: ANNO_TEXT, pos: 'below-right', labelBelow: false, colorAuto: true, color: '#000000', xshift: 0, yshift: 1, markIds: ['mD'] }],
    },
  });
  st.getState().gotoPage(idx);
  await sleep(1200);

  const out = {};
  // 展示态（画布上的 AnnoEquationView）
  const label = document.querySelector('.page-wrap .ae-ann-label');
  out.labelFound = !!label;
  if (label) {
    out.labelText = label.textContent.slice(0, 60);
    out.labelColor = label.style.color;
    const svgs = [...label.querySelectorAll('svg')];
    // 根号 path 有效性：getTotalLength 对被 <br> 腐蚀的 d 返回 0（解析失败），
    // 合法根号路径长度巨大（跨 400000 viewBox 单位）
    const path = label.querySelector('svg path');
    out.pathValid = false;
    try { out.pathValid = path ? path.getTotalLength() > 100 : false; } catch { out.pathValid = 'threw'; }
    out.pathDHasBr = path ? /<br>/.test(path.getAttribute('d') || '') : null;
    out.svgCount = svgs.length;
    out.svgs = svgs.map((sv) => {
      const cs = getComputedStyle(sv);
      const rc = sv.getBoundingClientRect();
      return {
        cls: sv.parentElement?.className,
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        fill: cs.fill, w: +rc.width.toFixed(1), h: +rc.height.toFixed(1),
        hasPath: !!sv.querySelector('path'),
      };
    });
    const hideTail = label.querySelector('.hide-tail');
    if (hideTail) {
      const cs = getComputedStyle(hideTail);
      out.hideTail = { display: cs.display, overflow: cs.overflow, w: hideTail.offsetWidth, h: hideTail.offsetHeight, color: cs.color };
    } else out.hideTail = 'MISSING';
    const sq = label.querySelector('.sqrt');
    out.sqrtBox = sq ? { w: sq.offsetWidth, h: sq.offsetHeight } : 'MISSING';
    // 分数线（对照组：正常渲染的部件）
    const frac = label.querySelector('.frac-line');
    out.fracLine = frac ? { w: frac.offsetWidth, h: frac.offsetHeight, bg: getComputedStyle(frac).background } : 'MISSING';
    // label 自身几何
    out.labelBox = { w: label.offsetWidth, h: label.offsetHeight };
  }
  // 对比：同一公式在正文行内的 sqrt 是否正常（InlineMath 路径）
  return out;
})()
