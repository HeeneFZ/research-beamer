// 放映窗截图序列：用户报告的 4/5/9/13 页（修复前留证）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  const goto = async (pageNo) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await sleep(350);
    for (let i = 1; i < pageNo; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
      await sleep(300);
    }
    await sleep(900);
  };
  await goto(4);
  window.__shotSeq = [
    { name: 'user-before-p4', wait: 500, run: () => {} },
    { name: 'user-before-p5', wait: 500, run: async () => { await goto(5); } },
    { name: 'user-before-p9', wait: 500, run: async () => { await goto(9); } },
    { name: 'user-before-p13', wait: 500, run: async () => { await goto(13); } },
  ];
  return { dpr: window.devicePixelRatio };
})()
