// 主窗编辑画布：用户工程第 4 页截图（验证编辑态分数线同样可见）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = await window.api.readFile('E:/work/课题/科大课题组/2608/thoery_show/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/work/课题/科大课题组/2608/thoery_show' });
  await sleep(3000);
  st.getState().gotoPage(3); // 第 4 页（0 起）
  await sleep(2500);
  const bands = [...document.querySelectorAll('.mode-edit .katex .frac-line')].map((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const scale = rect.width / (el.offsetWidth || 1);
    return { bandLocal: parseFloat(cs.backgroundSize.split(' ')[1]) || 0, scale: +scale.toFixed(2), dpr: window.devicePixelRatio };
  });
  window.__shotSeq = [{ name: 'user-edit-p4', wait: 600, run: () => {} }];
  return { bands, mainDpr: window.devicePixelRatio };
})()
