// 打包 exe 终验：annoeq 编辑器合成选区（端点=分式1首文本节点→分式1末尾空元素 mclose，
// 直接命中本轮修复的退化路径）→ mouseup → 读浮动条 needle
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  await sleep(3000);

  const r = await window.api.readFile('E:/projects/ai/BeamerApp/examples/zh_talk/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/projects/ai/BeamerApp/examples/zh_talk' });
  await sleep(2600);

  const s = st.getState();
  const idx = s.computed.pages.findIndex((p) => p.slide && p.slide.blocks.some((b) => b.type === 'annoeq'));
  if (idx < 0) return { error: 'no annoeq page' };
  const page = s.computed.pages[idx];
  const blk = page.slide.blocks.find((b) => b.type === 'annoeq');
  const LATEX = '\\frac{\\partial \\tilde{\\boldsymbol{T}}}{\\partial \\xi \\partial \\eta}=\\frac{\\partial \\tilde{\\boldsymbol{T}}}{\\partial \\eta \\partial \\xi}=0';
  s.updateBlock(page.slide.id, blk.id, { latex: LATEX, anno: undefined });
  st.getState().gotoPage(idx);
  await sleep(600);
  st.getState().setEditing({ slideId: page.slide.id, blockId: blk.id });
  await sleep(1400);

  const eqn = document.querySelector('.modal-anno .ae-eqn');
  if (!eqn) return { error: 'no eqn' };

  // 文本节点序列（排除 mathml）
  const texts = [];
  const walker = document.createTreeWalker(eqn, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('.katex-mathml'))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) if (walker.currentNode.data.length) texts.push(walker.currentNode);
  out.textIndex = texts.map((t) => t.data).join('');

  // 分式1 的 mclose：第一个 .mclose.nulldelimiter（空元素，退化端点）
  const mclose1 = eqn.querySelector('.mclose.nulldelimiter');
  if (!mclose1) return { error: 'no mclose', ...out };

  // 场景A：start=首文本节点(∂ 分式1分母)，end=分式1 mclose（空元素 offset0）→ 期望 needle=分式1
  const range = document.createRange();
  range.setStart(texts[0], 0);
  range.setEnd(mclose1, 0);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await sleep(300);
  out.sceneA_selbar = document.querySelector('.ae-selbar .ae-selbar-txt')?.textContent || null;

  // 场景B：start=「=」后的首文本（分式2），end=第二个 mclose → 期望 needle=分式2（不带 =0）
  const mclose2 = eqn.querySelectorAll('.mclose.nulldelimiter')[1];
  const eqText = texts.find((t) => t.data === '=' && texts.indexOf(t) > 7); // 第二个 =
  if (mclose2 && eqText) {
    sel.removeAllRanges();
    const r2 = document.createRange();
    // 分式2 起点：第二个 = 前的分式起始文本（texts 中 index 8 之后第一个 ∂）
    const frac2Start = texts.findIndex((t, i) => i > 8 && t.data === '∂' && texts.indexOf(t) === i);
    r2.setStart(texts[9], 0); // 分式2 分母首字符 ∂
    r2.setEnd(mclose2, 0);
    sel.removeAllRanges();
    sel.addRange(r2);
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(300);
    out.sceneB_selbar = document.querySelector('.ae-selbar .ae-selbar-txt')?.textContent || null;
  }

  out.passA = out.sceneA_selbar === '“∂ξ∂η∂T~\u200b”';
  out.passB = out.sceneB_selbar === '“∂η∂ξ∂T~\u200b”';
  return out;
})()
