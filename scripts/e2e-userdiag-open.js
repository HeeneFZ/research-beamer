// 主窗 eval：加载用户真实工程 → 开放映（放映窗按主窗所在屏的另一块屏定位——即屏 2，保真）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = await window.api.readFile('E:/work/课题/科大课题组/2608/thoery_show/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/work/课题/科大课题组/2608/thoery_show' });
  await sleep(3000);
  await st.getState().startPresent();
  await sleep(1500);
  return { ok: true, pages: st.getState().computed.pages.length, mainDpr: window.devicePixelRatio };
})()
