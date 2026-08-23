// E2E 放映窗交互检查（配合 e2e-interaction-check.js 末段的 startPresent）：
// 放大镜打开时 方向键/空格/滚轮/鼠标前进键 全部不得穿透到背后页面；Esc 关闭后翻页恢复。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  // 等放映页渲染
  let foot = null;
  for (let k = 0; k < 25; k++) {
    foot = document.querySelector('.s-foot-right');
    if (foot) break;
    await sleep(400);
  }
  if (!foot) return { error: 'no slide footer in present window' };
  const pageNo = () => (document.querySelector('.s-foot-right')?.textContent ?? '').trim();

  // 打开放映窗放大镜（fig-zoom-btn 视觉透明但可程序化点击）
  let zoomBtn = null;
  for (let k = 0; k < 10 && !zoomBtn; k++) {
    zoomBtn = document.querySelector('.fig-zoom-btn');
    if (!zoomBtn) await sleep(400);
  }
  if (!zoomBtn) return { error: 'no fig-zoom-btn (page has no bitmap figure?)' };
  zoomBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(500);
  if (!document.querySelector('.lb-overlay')) return { error: 'lightbox did not open' };

  const p0 = pageNo();
  // 方向键 / 空格 / 滚轮 / 鼠标前进键：全部不应翻页
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  document.querySelector('.lb-overlay').dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
  document.querySelector('.lb-overlay').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 4 }));
  await sleep(300);
  out.lightboxIsolation = { before: p0, after: pageNo(), pass: pageNo() === p0 };
  // 放大镜滚轮缩放本身应生效（115%）
  out.lightboxZoomWorks = { val: document.querySelector('.lb-zoomval')?.textContent, pass: /11[0-9]%|12[0-9]%/.test(document.querySelector('.lb-zoomval')?.textContent ?? '') };

  // Esc 关闭后翻页恢复
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(250);
  const closed = !document.querySelector('.lb-overlay');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await sleep(300);
  out.escThenAdvance = { closed, after: pageNo(), pass: closed && pageNo() !== p0 };

  window.api.sendPresentEvent({ type: 'end' });
  return out;
})()
