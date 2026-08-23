// 布局回归（聚合断言版）：四组合真实测量——rev = fit 时间序列方向反转数（DOM 收敛轮询），
// over = .s-body scroll 溢出（DOM 实测，pageLayout 无此字段），fit 取 SpacingState.fit。
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const scanAll = async (tag) => {
    const aspect = st.getState().deck.config.aspect;
    const pages = st.getState().computed.pages;
    let revBad = 0;
    const overBad = [];
    let minFit = Infinity;
    for (let i = 0; i < pages.length; i++) {
      const p0 = pages[i];
      if (p0.kind !== 'slide' || !p0.slide) continue;
      const fitKey = p0.slide.id + '|' + aspect;
      st.getState().gotoPage(i);
      const fitSeries = [];
      let prev = '';
      let stable = 0;
      for (let k = 0; k < 16; k++) {
        await sleep(400);
        fitSeries.push((st.getState().pageLayout[fitKey] || {}).fit ?? 1);
        const b0 = document.querySelector('.editor-canvas .s-body');
        const sig = JSON.stringify([
          st.getState().pageLayout[fitKey] || null,
          b0 ? b0.scrollHeight - b0.clientHeight : -1,
        ]);
        if (sig === prev) {
          stable++;
          if (stable >= 2 && k >= 2) break;
        } else stable = 0;
        prev = sig;
      }
      let reversals = 0;
      for (let k = 2; k < fitSeries.length; k++) {
        const d1 = fitSeries[k - 1] - fitSeries[k - 2];
        const d2 = fitSeries[k] - fitSeries[k - 1];
        if (d1 * d2 < 0) reversals++;
      }
      const body = document.querySelector('.editor-canvas .s-body');
      const over = body ? body.scrollHeight - body.clientHeight : 0;
      const fit = (st.getState().pageLayout[fitKey] || {}).fit ?? 1;
      if (reversals > 0) revBad++;
      if (over > 10) overBad.push({ no: p0.no, over });
      if (fit < minFit) minFit = fit;
    }
    return { tag, pages: pages.length, revBad, overBad, minFit: minFit === Infinity ? null : minFit };
  };

  const out = [];
  await sleep(2600);
  out.push(await scanAll('zh@16:9'));
  st.getState().setConfig({ aspect: '4:3' });
  await sleep(1500);
  out.push(await scanAll('zh@4:3'));
  st.getState().setConfig({ aspect: '16:9' });
  await sleep(600);
  await st.getState().loadExample('examples/en_talk');
  await sleep(2600);
  out.push(await scanAll('en@16:9'));
  st.getState().setConfig({ aspect: '4:3' });
  await sleep(1500);
  out.push(await scanAll('en@4:3'));
  const pass = out.every((r) => r.revBad === 0 && r.overBad.length === 0);
  return { pass, combos: out };
})()
