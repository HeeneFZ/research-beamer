// 放映窗诊断：翻到用户报告的 4/5/9/13 页（1 起），dump 每条分数线完整渲染态 + 截图
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { dpr: window.devicePixelRatio, innerW: window.innerWidth, innerH: window.innerHeight };
  const targets = [4, 5, 9, 13]; // 1-based 页码
  out.pages = {};
  for (const pageNo of targets) {
    // 经 IPC 无法直达放映窗 store —— 用键盘跳页：Home 后 N 次 ArrowRight
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await sleep(350);
    for (let i = 1; i < pageNo; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
      await sleep(320);
    }
    await sleep(1200);
    const rules = [...document.querySelectorAll('.katex .frac-line')];
    const anns = [...document.querySelectorAll('.ae-ann .katex .frac-line')];
    out.pages[pageNo] = {
      url: location.hash,
      fracTotal: rules.length,
      inAnno: anns.length,
      rules: rules.map((el) => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const scale = rect.width / (el.offsetWidth || 1);
        return {
          bg: cs.backgroundImage.slice(0, 28),
          bgSize: cs.backgroundSize,
          rectW: +rect.width.toFixed(2), rectH: +rect.height.toFixed(2),
          offW: el.offsetWidth,
          fs: cs.fontSize,
          bandLocal: parseFloat(cs.backgroundSize.split(' ')[1]) || 0,
          bandScreen: +((parseFloat(cs.backgroundSize.split(' ')[1]) || 0) * scale).toFixed(3),
          scale: +scale.toFixed(3),
          dy: el.dataset.rsnapDy ?? null,
          transform: el.style.transform || '',
          borderB: cs.borderBottomWidth + ' ' + cs.borderBottomColor,
          display: cs.display, vis: cs.visibility,
        };
      }),
    };
  }
  return out;
})()
