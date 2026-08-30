// PDF 导出路径验证：print 管线恢复纯设计值（分数线带 = 0.04em×fs、根号线 v40）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  st.getState().newProject();
  await sleep(1200);
  const s = st.getState();
  const idx = s.computed.pages.findIndex((p) => p.kind === 'slide' && p.slide?.layout === 'content' && (p.slide?.blocks || []).length === 0);
  st.getState().gotoPage(idx);
  await sleep(500);
  const page = st.getState().computed.pages[st.getState().current];
  st.getState().insertBlock(page.slide.id, null, 'equation', { latex: '\\frac{a+b}{c-d} + \\sqrt{\\frac{x}{y}}' });
  await sleep(1000);
  // 走真实 UI 路径：菜单栏 文件 → 导出 PDF…（render exportPDF 组件函数 + restyleRulesForPrint）
  const menus = [...document.querySelectorAll('.menu-bar button, .menu-title, [class*=menu] button')];
  const fileBtn = menus.find((b) => (b.textContent || '').trim().startsWith('文件'));
  if (!fileBtn) return { error: 'no file menu' };
  fileBtn.click();
  await sleep(300);
  const items = [...document.querySelectorAll('.menu-drop .menu-item')];
  const exp = items.find((it) => (it.textContent || '').includes('导出 PDF'));
  if (!exp) return { error: 'no export item' };
  exp.click();
  // 导出含 15s 图片轮询上限，等快照落盘
  for (let i = 0; i < 40 && !window.__printRuleCheck; i++) await sleep(500);
  const c = window.__printRuleCheck;
  if (!c) return { error: 'no snapshot' };
  return {
    ...c,
    bandIsDesign: Math.abs(c.bandPx - c.fontSizePx * 0.04) < 0.05,
    sqrtRestored: c.sqrtV === 40,
    pass: Math.abs(c.bandPx - c.fontSizePx * 0.04) < 0.05 && c.sqrtV === 40,
  };
})()
