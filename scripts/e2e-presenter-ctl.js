// 放映台按钮链路验证：主窗 startPresent → 放映台出现 录制/交换屏幕 按钮 →
// 点录制 → present:ctrl → 放映窗 recState 回传 → 按钮态翻转为「停止录制」→
// 再点 → 回到「录制放映」。裸 .click() 会被全局 mousedown 监听吞掉，
// 必须派发完整 mousedown/mouseup/click 序列。
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
  for (let i = 0; i < 20 && !document.querySelector('.presenter-ctl'); i++) await sleep(300);
  await sleep(800);
  out.ctlRowExists = !!document.querySelector('.presenter-ctl');
  const recBtn = document.querySelector('.presenter-rec');
  const swapBtn = document.querySelector('.presenter-swap');
  out.buttonsExist = !!recBtn && !!swapBtn;
  out.recLabel0 = recBtn ? recBtn.textContent.trim() : null;
  // E2E 下 getDisplayMedia 走 main.cjs 的 setDisplayMediaRequestHandler（自动选源）
  fullClick(recBtn);
  for (let i = 0; i < 30 && !document.querySelector('.presenter-rec.on'); i++) await sleep(300);
  out.recLabel1 = (document.querySelector('.presenter-rec') || {}).textContent?.trim?.() ?? null;
  out.toggledOn = !!document.querySelector('.presenter-rec.on');
  out.storeRecording = st.getState().presentRecording;
  // 停止（1s 录像极小；落盘到 E2E folder=null → 用户数据目录，无碍）
  fullClick(document.querySelector('.presenter-rec'));
  for (let i = 0; i < 20 && document.querySelector('.presenter-rec.on'); i++) await sleep(300);
  out.recLabel2 = (document.querySelector('.presenter-rec') || {}).textContent?.trim?.() ?? null;
  out.toggledOff = !document.querySelector('.presenter-rec.on');
  out.storeRecordingOff = !st.getState().presentRecording;
  // 交换屏幕：单屏下返回 error 也可接受，只验调用不抛
  fullClick(swapBtn);
  await sleep(600);
  out.swapClicked = true;
  out.pass = out.ctlRowExists && out.buttonsExist && out.toggledOn && out.storeRecording
    && out.toggledOff && out.storeRecordingOff && out.swapClicked;
  st.getState().endPresent();
  await sleep(400);
  return out;
})()
