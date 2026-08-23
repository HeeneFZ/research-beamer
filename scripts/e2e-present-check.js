// E2E 放映窗检查：由 E2E_EVAL_PRESENT 注入放映窗执行（配合 e2e-layout-check.js 末段的 startPresent）。
// 验证 pageFits 已随 PresentState 广播同步：放映窗正文计算字号应与编辑窗同页一致。
// 用法：E2E_EVAL="$(cat scripts/e2e-layout-check.js)" E2E_EVAL_PRESENT="$(cat scripts/e2e-present-check.js)" npx electron .
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let body = null;
  for (let k = 0; k < 25; k++) {
    body = document.querySelector('.sv .s-body');
    if (body) break;
    await sleep(400);
  }
  if (!body) return { error: 'no .s-body in present window' };
  // 等一页渲染稳定
  await sleep(1200);
  const cs = getComputedStyle(body);
  return {
    fsPx: Math.round(parseFloat(cs.fontSize) * 100) / 100,
    bodyFitVar: getComputedStyle(document.querySelector('.sv')).getPropertyValue('--body-fit').trim() || '1',
    over: body.scrollHeight - body.clientHeight,
  };
})()
