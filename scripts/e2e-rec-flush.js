// 录制落盘保护链路验证：录制→停止→(落盘中)立刻结束放映→录像必须已保存。
// 旧实现在 recState off 后 fast-path 直接关窗杀掉 onstop 落盘链（静默丢录像）；
// 现以 recStopped ack + 30s 兜底保护。判定走 store 级 flashMsg（toast DOM 有自动消失时序）。
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fullClick = (el) => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  const out = {};
  st.getState().newProject();
  await sleep(1200);
  await st.getState().startPresent();
  for (let i = 0; i < 20 && !document.querySelector('.presenter-rec'); i++) await sleep(300);
  await sleep(800);
  fullClick(document.querySelector('.presenter-rec'));
  for (let i = 0; i < 30 && !document.querySelector('.presenter-rec.on'); i++) await sleep(300);
  out.recStarted = !!document.querySelector('.presenter-rec.on');
  await sleep(1500); // 累积 1.5s 录像
  fullClick(document.querySelector('.presenter-rec')); // 停止（落盘链启动）
  await sleep(200);  // 按钮已翻回（recState off）但落盘在途 —— 正是旧 bug 的窗口
  out.btnShowsStopped = !document.querySelector('.presenter-rec.on');
  // 立刻结束放映（旧实现 fast-path 直接关窗杀落盘链）
  st.getState().endPresent();
  let savedMsg = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const m = st.getState().flashMsg || '';
    if (m.includes('录像已保存')) { savedMsg = m; break; }
  }
  out.savedMsg = savedMsg;
  out.pass = out.recStarted && out.btnShowsStopped && !!savedMsg;
  return out;
})()
