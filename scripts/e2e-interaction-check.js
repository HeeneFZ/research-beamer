// E2E 交互回归检查（第十九轮 code review 修复）：
//   1) 放大镜打开时 Backspace/Alt+← 不触发页面回跳（useBackNav 键盘守卫）
//   2) 放大镜滚轮缩放走原生非 passive 监听（缩放生效）
//   3) 放大镜双击重置（hint 承诺的能力补实现）
//   4) 输入焦点内 Ctrl+Z 不触发全局 deck 撤销
//   5) 放映窗：放大镜打开时方向键/空格不翻页、滚轮不翻页
// 用法：npm run build && E2E_EVAL="$(cat scripts/e2e-interaction-check.js)" E2E_EVAL_PRESENT="$(cat scripts/e2e-interaction-present.js)" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  await sleep(2600); // zh_talk 加载

  // 找第一张带位图的 figure（拿真实 abs 路径与其所在页码——放映验证需要停在该页）
  const folder = st.getState().folder;
  let figAbs = null;
  let figPage = -1;
  st.getState().computed.pages.forEach((p, i) => {
    if (figAbs || p.kind !== 'slide' || !p.slide) return;
    const f = p.slide.blocks.find((b) => b.type === 'figure' && b.src && !/\.(pdf|eps)$/i.test(b.src));
    if (f) { figAbs = folder + '/' + f.src; figPage = i; }
  });
  if (!figAbs) return { error: 'no bitmap figure found' };

  // 1) Backspace 守卫：跳转过（jumpStack 非空）后开放大镜，按 Backspace 不应回跳
  st.getState().gotoPage(3, true);
  await sleep(300);
  const before = st.getState().current;
  st.getState().setLightbox({ abs: figAbs, ext: figAbs.split('.').pop().toLowerCase() });
  await sleep(400);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
  await sleep(200);
  out.backspaceGuard = { before, after: st.getState().current, pass: st.getState().current === before };

  // 2) 滚轮缩放生效（原生非 passive 监听）；3) 双击重置回 100%
  const overlay = document.querySelector('.lb-overlay');
  const zoomVal = () => parseInt(document.querySelector('.lb-zoomval')?.textContent ?? '0', 10);
  if (overlay) {
    const v0 = zoomVal();
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    await sleep(150);
    const v1 = zoomVal();
    document.querySelector('.lb-stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(150);
    out.lightboxWheelZoom = { v0, v1, pass: v1 > v0 };
    out.dblclickReset = { after: zoomVal(), pass: zoomVal() === 100 };
  } else {
    out.lightboxWheelZoom = { error: 'no overlay' };
  }

  // 关闭放大镜（Esc 归 LightboxInner 处理）
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(250);
  out.escClosesLightbox = { pass: st.getState().lightbox === null };

  // 4) 输入焦点内 Ctrl+Z 不触发全局撤销
  const title0 = 'E2E守卫标题';
  st.getState().setConfig({ title: title0 });
  await sleep(700); // 历史防抖快照落栈
  const notes = document.querySelector('.notes-input');
  notes.focus();
  notes.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await sleep(250);
  out.ctrlZGuard = { title: st.getState().deck.config.title, pass: st.getState().deck.config.title === title0 };
  // 焦点离开输入框后 Ctrl+Z 仍应全局撤销（守卫不误伤）
  notes.blur();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await sleep(250);
  out.ctrlZGlobal = { title: st.getState().deck.config.title, pass: st.getState().deck.config.title !== title0 };

  // 5) 打开放映窗（停在含位图图片的页，E2E_EVAL_PRESENT 接力验证放大镜键盘/滚轮隔离）
  st.getState().gotoPage(figPage, false);
  await st.getState().startPresent();
  await sleep(3000); // 放映窗加载 + ready 握手 + 状态重播
  return out;
})()
