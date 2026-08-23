// E2E 排版冒烟脚本：内容经 E2E_EVAL 环境变量注入渲染进程执行。
// 用法：E2E_WATCHDOG_MS=280000 E2E_EVAL="$(cat scripts/e2e-layout-check.js)" E2E_EVAL_PRESENT="$(cat scripts/e2e-present-check.js)" npx electron .
//（逐页收敛轮询 4 组合耗时 >120s 默认看门狗，必须调大；快速回归门用 e2e-layout-agg.js）
// 覆盖 zh/en 示例 × 16:9/4:3 四组合：逐页等待排版引擎收敛（静默探测，终态应立刻稳定），
// 读取 .s-body 计算字号/行高/题注字号/图宽/溢出与页级排版状态（s/imgH/fit）。
// 关键断言点：字号全 deck 统一（未被压实的页 fsPx 完全一致）；fit 无振荡（rev=0）。
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const scanAll = async (tag) => {
    const aspect = st.getState().deck.config.aspect;
    const pages = st.getState().computed.pages;
    const rows = [];
    for (let i = 0; i < pages.length; i++) {
      st.getState().gotoPage(i);
      // 收敛轮询：pageLayout + 溢出量 + EPS 待转换标记 连续 3 轮不变且至少 4 轮（2s）即稳定
      //（打开工程时胶片缩略图已后台预算全部页，此处通常第一轮即稳定）
      const fitKeyNow = (() => {
        const p0 = st.getState().computed.pages[i];
        return p0.slide ? p0.slide.id + '|' + aspect : '';
      })();
      const fitSeries = [];
      let prev = '';
      let stable = 0;
      for (let k = 0; k < 24; k++) {
        await sleep(500);
        fitSeries.push((st.getState().pageLayout[fitKeyNow] || {}).fit ?? 1);
        const b0 = document.querySelector('.editor-canvas .s-body');
        const sigNow = JSON.stringify([
          st.getState().pageLayout,
          b0 ? b0.scrollHeight - b0.clientHeight : -1,
          !!document.querySelector('[data-eps-pending]'),
        ]);
        if (sigNow === prev && !document.querySelector('[data-eps-pending]')) {
          stable++;
          if (stable >= 3 && k >= 3) break;
        } else {
          stable = 0;
        }
        prev = sigNow;
      }
      // fit 方向反转计数（>0 即「压→松→压」振荡，抖动回归探针）
      let reversals = 0;
      for (let k = 2; k < fitSeries.length; k++) {
        const d1 = fitSeries[k - 1] - fitSeries[k - 2];
        const d2 = fitSeries[k] - fitSeries[k - 1];
        if (d1 * d2 < 0) reversals++;
      }
      const pg = st.getState().computed.pages[i];
      const body = document.querySelector('.editor-canvas .s-body');
      if (!body) { rows.push({ no: pg.no, layout: pg.kind }); continue; }
      const cs = getComputedStyle(body);
      const cap = body.querySelector('.fig-caption, .tbl-caption');
      const fig = body.querySelector('.fig img, .fig canvas');
      const lay = st.getState().pageLayout[fitKeyNow];
      rows.push({
        no: pg.no,
        layout: (pg.slide && pg.slide.layout) || pg.kind,
        fsPx: Math.round(parseFloat(cs.fontSize) * 100) / 100,
        lhRatio: Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) / 100,
        capPx: cap ? Math.round(parseFloat(getComputedStyle(cap).fontSize) * 100) / 100 : null,
        figWpx: fig ? Math.round(fig.getBoundingClientRect().width) : null,
        s: lay ? lay.s : 0,
        imgH: lay ? lay.imgH : null,
        fit: lay ? lay.fit : 1,
        rev: reversals,
        over: body.scrollHeight - body.clientHeight,
      });
    }
    return { tag, rows };
  };

  const out = [];
  await sleep(2600); // 首个示例（zh_talk）加载 + 胶片后台预算
  out.push(await scanAll('zh@16:9'));

  st.getState().setConfig({ aspect: '4:3' });
  await sleep(1200);
  out.push(await scanAll('zh@4:3'));
  st.getState().setConfig({ aspect: '16:9' });
  await sleep(600);

  await st.getState().loadExample('examples/en_talk');
  await sleep(2600);
  out.push(await scanAll('en@16:9'));

  st.getState().setConfig({ aspect: '4:3' });
  await sleep(1200);
  out.push(await scanAll('en@4:3'));

  // 页级 fontScale 冒烟：把第 5 页设为 150% 再恢复，验证正文区字号变化而页眉不变
  st.getState().setConfig({ aspect: '16:9' });
  await st.getState().loadExample('examples/zh_talk');
  await sleep(2000);
  const slide5 = st.getState().computed.pages[4].slide;
  st.getState().gotoPage(4);
  await sleep(800);
  const headerFs0 = parseFloat(getComputedStyle(document.querySelector('.s-title')).fontSize);
  const bodyFs0 = parseFloat(getComputedStyle(document.querySelector('.editor-canvas .s-body')).fontSize);
  st.getState().updateSlide(slide5.id, { fontScale: 1.5 });
  await sleep(1500);
  const headerFs1 = parseFloat(getComputedStyle(document.querySelector('.s-title')).fontSize);
  const bodyFs1 = parseFloat(getComputedStyle(document.querySelector('.editor-canvas .s-body')).fontSize);
  st.getState().updateSlide(slide5.id, { fontScale: undefined });
  out.push({
    tag: 'fontScale-page5',
    rows: [{
      bodyFs0, bodyFs1, headerFs0, headerFs1,
      bodyScaled: Math.abs(bodyFs1 - bodyFs0 * 1.5) < 1.2,
      headerUnchanged: headerFs0 === headerFs1,
    }],
  });

  // 末段：图重页（第 11 页，index 10）收敛后进放映（供 E2E_EVAL_PRESENT 比对）
  st.getState().gotoPage(10);
  let prevLay = '';
  for (let k = 0; k < 24; k++) {
    await sleep(500);
    const f = JSON.stringify(st.getState().pageLayout);
    if (f === prevLay && k >= 3) break;
    prevLay = f;
  }
  const body = document.querySelector('.editor-canvas .s-body');
  const pg11 = st.getState().computed.pages[10];
  const lay11 = st.getState().pageLayout[pg11.slide.id + '|16:9'];
  out.push({
    tag: 'zh@16:9-page11-for-present',
    rows: [{
      no: 11,
      fsPx: body ? Math.round(parseFloat(getComputedStyle(body).fontSize) * 100) / 100 : null,
      fit: lay11 ? lay11.fit : 1,
      over: body ? body.scrollHeight - body.clientHeight : null,
    }],
  });
  await st.getState().startPresent();

  return out;
})()
