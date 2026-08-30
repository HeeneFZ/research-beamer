// 放映窗 eval：规则线在放映态同样被 restyle（背景带接管 + 设备行下限）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 翻到含公式的页（封面/目录之后）
  for (let i = 0; i < 4; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(400);
    if (document.querySelectorAll('.katex .frac-line').length) break;
  }
  // 规则线 restyle 走 MutationObserver → rAF 批处理，翻页渲染后给一拍沉降
  await sleep(1500);
  const rules = [...document.querySelectorAll('.katex .frac-line')];
  const dpr = window.devicePixelRatio || 1;
  const checks = rules.map((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const scale = rect.width / el.offsetWidth || 1;
    const bh = parseFloat(cs.backgroundSize.split(' ')[1]) || 0;
    return {
      banded: cs.backgroundImage.includes('gradient') && bh > 0,
      screenOk: bh * scale * dpr >= 0.99,
    };
  });
  return {
    ruleCount: rules.length,
    allBanded: checks.length > 0 && checks.every((c) => c.banded),
    allScreenOk: checks.length > 0 && checks.every((c) => c.screenOk),
    pass: checks.length > 0 && checks.every((c) => c.banded && c.screenOk),
  };
})()
