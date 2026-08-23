// E2E 放映窗注释公式块检查（配合 e2e-annoeq-check.js 末段的 startPresent）：
// 放映页（当前页 = annoeq 页）渲染标注标签/高亮框/引线；翻页后消失。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  let foot = null;
  for (let k = 0; k < 25; k++) {
    foot = document.querySelector('.s-foot-right');
    if (foot) break;
    await sleep(400);
  }
  if (!foot) return { error: 'no slide footer in present window' };

  const labels = document.querySelectorAll('.ae-ann-label').length;
  const boxes = document.querySelectorAll('.ae-mark-box').length;
  const lines = document.querySelectorAll('.ae-svg polyline').length;
  out.presentRender = { labels, boxes, lines, ok: labels === 6 && boxes === 6 && lines === 6 };
  // 展示态不拦截翻页：标签层 pointer-events none，方向键翻页后标注消失
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await sleep(500);
  out.afterAdvance = {
    labels: document.querySelectorAll('.ae-ann-label').length,
    page: (document.querySelector('.s-foot-right')?.textContent ?? '').trim(),
    ok: document.querySelectorAll('.ae-ann-label').length === 0,
  };

  window.api.sendPresentEvent({ type: 'end' });
  return out;
})()
