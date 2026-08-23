// E2E 节分隔页子节列表左移验证（编辑窗）：
// 列宽 34%→50%（相对卡片内容盒）+ 卡内 gap 5→4cqw：子节文字空间 20.8→32cqw（+54%）。
// 断言：列宽占比 ≈50%；9 字小节标题（旧 34% 下必换行）单行不换行。
// 用法：npm run build && E2E_EVAL="$(cat scripts/e2e-divider-check.js)" E2E_SCREENSHOT="$(pwd)/test_figs/divider-check.png" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  const items = st.getState().deck.items;
  const methodSec = items.find((x) => x.kind === 'section' && x.section.title === '方法');
  const sub = items.find((x) => x.kind === 'section' && x.section.level === 2 && x.section.title === '整体架构');
  if (!methodSec || !sub || methodSec.kind !== 'section' || sub.kind !== 'section') return { error: 'sections missing' };
  const origTitle = sub.section.title;
  const LONG9 = '整体架构与技术路线'; // 9 字：旧列宽（≈7.8 字容量）必换行，新列宽（≈9.8 字）应单行
  st.getState().renameSection(sub.section.id, LONG9);
  await sleep(300);

  const pages = st.getState().computed.pages;
  const divIdx = pages.findIndex((p) => p.kind === 'divider' && p.section && p.section.id === methodSec.section.id);
  st.getState().gotoPage(divIdx);
  await sleep(900);

  // 同一同步块内读完全部测量值（避免读间重渲染导致坐标系混杂）
  const card = document.querySelector('.editor-canvas .divider-card');
  const subs = card && card.querySelector('.divider-subs');
  if (!card || !subs) return { ...out, error: 'divider not rendered', divIdx };
  const cardW = card.getBoundingClientRect().width;
  const cardPadL = parseFloat(getComputedStyle(card).paddingLeft);
  const cardPadR = parseFloat(getComputedStyle(card).paddingRight);
  const scale = cardW / card.offsetWidth; // 画布 transform 缩放：rect(绘制) = layout × scale
  const innerW = cardW - (cardPadL + cardPadR) * scale;
  const subsW = subs.getBoundingClientRect().width;
  const widthPct = Math.round((subsW / innerW) * 1000) / 10;
  const rows = [...subs.querySelectorAll('.divider-sub')].map((el) => ({
    text: el.textContent,
    h: el.getBoundingClientRect().height,
  }));
  const fsPx = parseFloat(getComputedStyle(subs.querySelector('.divider-sub')).fontSize) * scale;
  // lh=normal ≈ 1.2–1.4em：单行高度 ≤ 1.6×字号即判单行（含抗锯齿余量）
  const noWrap = rows.every((r) => r.h <= fsPx * 1.6);

  out.dividerSubs = {
    divPage: divIdx + 1, widthPct, rows, fsPx: Math.round(fsPx * 10) / 10,
    pass: widthPct >= 49 && widthPct <= 51 && noWrap,
  };

  st.getState().renameSection(sub.section.id, origTitle);
  await sleep(300);
  st.getState().gotoPage(divIdx); // 停留在分隔页供截图
  await sleep(400);
  return out;
})()
