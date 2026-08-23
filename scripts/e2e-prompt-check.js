// E2E 回归：块工具栏「出现顺序…」输入弹窗入口（第廿四轮——window.prompt 在 Electron 抛
// "prompt() is not supported."，自绘模态框替代）。注：块/列表项徽章入口第廿五轮起改为
// 网格快捷选择器，归 scripts/e2e-order-picker.js 覆盖；本脚本只守工具栏 ＋ 菜单的弹窗路径。
//   1) hover 块 → 工具栏 ＋ → 「出现顺序…」弹出自绘模态输入框（不再走 window.prompt）
//   2) 输入 2 回车 → block.order 写为 2，弹窗关闭
//   3) 重开弹窗 → Esc 取消 → order 保持 2（取消通道不篡值）
// 用法：npm run build && E2E_EVAL="$(cat scripts/e2e-prompt-check.js)" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  await sleep(2600); // zh_talk 加载

  // 找第一张无 order 的段落块（避免撞上示例既有 order 页，干扰断言基线）
  let pageIndex = -1;
  let blockId = null;
  st.getState().computed.pages.forEach((p, i) => {
    if (blockId || p.kind !== 'slide' || !p.slide) return;
    const b = p.slide.blocks.find((x) => x.type === 'paragraph' && x.order == null);
    if (b) { pageIndex = i; blockId = b.id; }
  });
  if (!blockId) return { error: 'no plain paragraph found' };
  const orderOf = () =>
    st.getState().computed.pages[pageIndex].slide.blocks.find((b) => b.id === blockId)?.order;

  st.getState().gotoPage(pageIndex, false);
  await sleep(600);

  // hover 出工具栏 → ＋ → 「出现顺序…」→ 返回弹窗输入框（工具栏会随指针离场自动隐藏，每次须重走 hover）
  const openDialog = async () => {
    const el = document.querySelector(`.editor-canvas [data-bid="${blockId}"]`);
    if (!el) return null;
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(500);
    const plus = document.querySelector('.btools-float button[title="插入"]');
    if (!plus) return null;
    plus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(300);
    const item = [...document.querySelectorAll('.btools-menu-float .ref-picker-item')]
      .find((n) => n.textContent.includes('出现顺序'));
    if (!item) return null;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    let input = null;
    for (let i = 0; i < 20 && !input; i++) { await sleep(100); input = document.querySelector('.modal-mask input.txt'); }
    return input;
  };

  // 1) 弹窗打开
  const input = await openDialog();
  out.toolbarEntryOpensDialog = { pass: !!input };
  if (!input) return out;

  // 2) 键入 2 + Enter → order=2 落库，弹窗关闭（React 受控输入须走原生 setter）
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '2');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(400);
  out.enterSetsOrder = { order: orderOf(), pass: orderOf() === 2 && !document.querySelector('.modal-mask') };

  // 3) 重开 → Esc 取消 → order 不变、弹窗关闭
  const input2 = await openDialog();
  if (!input2) { out.reopenEscCancel = { error: 'dialog did not reopen' }; return out; }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(300);
  out.reopenEscCancel = {
    order: orderOf(),
    pass: orderOf() === 2 && !document.querySelector('.modal-mask'),
  };

  // 探针收尾：还原 order，别给后续 E2E 探针留脏基线
  st.getState().updateBlock(st.getState().computed.pages[pageIndex].slide.id, blockId, { order: undefined });
  await sleep(200);
  return out;
})()
