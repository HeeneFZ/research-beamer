// 截图验证：annoeq 标注中的根号渲染
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
  window.__shotSeq = [{ name: 'sqrt-anno', wait: 900, run: () => {} }];
  return { ok: true };
})()
