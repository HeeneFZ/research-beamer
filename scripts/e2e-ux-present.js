// E2E 放映窗：出现顺序门控——第 4 页有 order=2 段落 + order=1 列表项。
// 初始两者皆隐藏；第一次 advance 揭示 order=1（列表项）；第二次揭示 order=2（段落）。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  let body = null;
  for (let k = 0; k < 25; k++) {
    body = document.querySelector('.s-body');
    if (body) break;
    await sleep(400);
  }
  if (!body) return { error: 'no slide body in present window' };
  await sleep(400);
  const hidF = () => [...document.querySelectorAll('.s-body .fblock')].filter((b) => getComputedStyle(b).visibility === 'hidden').length;
  const hidLi = () => [...document.querySelectorAll('.s-body .items li')].filter((li) => getComputedStyle(li).visibility === 'hidden').length;
  const adv = async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(500);
  };
  const s0 = { f: hidF(), li: hidLi() };
  await adv();
  const s1 = { f: hidF(), li: hidLi() };
  await adv();
  const s2 = { f: hidF(), li: hidLi() };
  out.revealGating = {
    s0, s1, s2,
    pass: s0.f === 1 && s0.li === 1 && s1.li === 0 && s1.f === 1 && s2.f === 0,
  };
  window.api.sendPresentEvent({ type: 'end' });
  return out;
})()
