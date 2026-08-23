// E2E Logo 验证（第卅五轮：锚定态默认 + 浮动态）：
// 锚定几何（卡右下 4cqw/5.3cqh、宽上限 24cqw）/ 结尾页同步 / 拖拽转浮动 / 手柄调宽 / 复位 / 删除与占位
// 用法：npm run build && E2E_EVAL="$(cat scripts/e2e-logo-check.js)" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const state = () => st.getState();
  await sleep(400);

  // 0) 锚定态默认：logo 在 title-card 内右下角，几何按卡片实测
  const logo0 = document.querySelector('.editor-canvas .title-card .logo-in-card');
  out.anchor = { present: !!logo0, persistedPos: state().deck.config.logoPos ?? null };
  if (logo0) {
    const card = document.querySelector('.editor-canvas .title-card').getBoundingClientRect();
    const pr = logo0.closest('.sv').getBoundingClientRect();
    const lr = logo0.getBoundingClientRect();
    const g = {
      rightGapCqw: +(((card.right - lr.right) / pr.width) * 100).toFixed(2),
      bottomGapCqh: +(((card.bottom - lr.bottom) / pr.height) * 100).toFixed(2),
      widthCqw: +((lr.width / pr.width) * 100).toFixed(2),
    };
    out.anchor.gaps = g;
    out.anchor.pass = Math.abs(g.rightGapCqw - 4) < 0.8 && Math.abs(g.bottomGapCqh - 5.3) < 0.8 && Math.abs(g.widthCqw - 24) < 1.2;
  }

  // 1) 结尾页同步（锚定态在 end-card 内）
  const n = state().computed.pages.length;
  state().gotoPage(n - 1);
  await sleep(500);
  out.endPage = { anchored: !!document.querySelector('.editor-canvas .end-card .logo-in-card') };

  // 2) 拖拽：以实测起点换算，拖后应持久化 logoPos 且转为浮动态
  state().gotoPage(0);
  await sleep(500);
  const el = document.querySelector('.editor-canvas .logo-in-card');
  const pr = el.closest('.sv').getBoundingClientRect();
  const lr = el.getBoundingClientRect();
  const p0 = {
    x: +(((lr.left - pr.left) / pr.width) * 100).toFixed(1),
    y: +(((lr.top - pr.top) / pr.height) * 100).toFixed(1),
    w: +((lr.width / pr.width) * 100).toFixed(1),
  };
  const cx = lr.left + lr.width / 2;
  const cy = lr.top + lr.height / 2;
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, button: 0 }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: cx - 60, clientY: cy - 25 }));
  await sleep(60);
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: cx - 60, clientY: cy - 25 }));
  await sleep(250);
  const pd = state().deck.config.logoPos;
  const exX = +(p0.x - (60 / pr.width) * 100).toFixed(1);
  const exY = +(p0.y - (25 / pr.height) * 100).toFixed(1);
  out.drag = { from: p0, pos: pd, expect: { x: exX, y: exY }, pass: !!pd && Math.abs(pd.x - exX) < 0.6 && Math.abs(pd.y - exY) < 0.6 };
  out.drag.floatingRender = !!document.querySelector('.editor-canvas .cover-stage ~ .logo-float, .editor-canvas .logo-float');

  // 3) 右缘手柄调宽（+50px）
  const el2 = document.querySelector('.editor-canvas .logo-float');
  const hr = el2.querySelector('.edge-rz-r').getBoundingClientRect();
  el2.querySelector('.edge-rz-r').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: hr.left + 5, clientY: hr.top + 5, button: 0 }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: hr.left + 55, clientY: hr.top + 5 }));
  await sleep(60);
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: hr.left + 55, clientY: hr.top + 5 }));
  await sleep(250);
  const pr2 = state().deck.config.logoPos;
  const exW = +(pd.w + (50 / pr.width) * 100).toFixed(1);
  out.resize = { pos: pr2, expectW: exW, pass: !!pr2 && Math.abs(pr2.w - exW) < 0.6 && pr2.x === pd.x && pr2.y === pd.y };

  // 4) 复位：回锚定态（logoPos 清空、渲染回卡内）
  document.querySelector('.editor-canvas .logo-float .logo-tools .reset').click();
  await sleep(250);
  out.reset = {
    pos: state().deck.config.logoPos ?? null,
    anchoredBack: !!document.querySelector('.editor-canvas .title-card .logo-in-card'),
  };

  // 5) 删除 → ＋Logo 占位；撤销恢复
  document.querySelector('.editor-canvas .logo-in-card .logo-tools .danger').click();
  await sleep(250);
  out.remove = {
    logo: state().deck.config.logo ?? null,
    chip: !!document.querySelector('.editor-canvas .logo-add-chip'),
  };
  state().undo();
  await sleep(200);
  out.restore = { logo: state().deck.config.logo ?? null, anchored: !!document.querySelector('.editor-canvas .title-card .logo-in-card') };

  return out;
})()
