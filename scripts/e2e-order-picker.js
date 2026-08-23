// E2E 回归：出现顺序快捷选择器（第廿五轮——徽章 ⏱ 悬停浮现 + 网格快选替代输入弹窗）
//   1) 未设序段落：块右上角常驻 DOM ⏱ 徽章（CSS 悬停才显形，此处断言存在与类态）
//   2) 点击徽章 → .ord-picker 弹出：10 格（取消+1~9）+ 自定义输入行；未设序时「取消」高亮
//   3) 选择器内部点击不穿透进编辑态（portal 事件上冒守卫）
//   4) 点 3 → order=3 落库、选择器关、徽章变常驻数字
//   5) 重开 → 3 高亮；点「取消」→ order 清除、徽章回到 ⏱
//   6) 列表项 ⏱ → 输入行键入 2 回车 → itemOrders[0]=2；再开点「取消」→ 清除
//   7) 单开语义：块选择器开着点另一块徽章 → DOM 中始终仅一层 .ord-picker
//   8) 外点 mousedown / 画布 wheel → 关闭且不篡值
//   9) 列表块车位：块徽章（in-list 左移）与首项 li-ord 包围盒不得相交
// 用法：npm run build && E2E_EVAL="$(cat scripts/e2e-order-picker.js)" npx electron .
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  let step = 'init';
  try {
    await sleep(2600); // zh_talk 加载

    // 找同时含「未设序段落」与「列表块」的页（跨块单开探针需要两块同页）
    let page = null;
    st.getState().computed.pages.forEach((p) => {
      if (page || p.kind !== 'slide' || !p.slide) return;
      const paraB = p.slide.blocks.find((b) => b.type === 'paragraph' && b.order == null);
      const listB = p.slide.blocks.find((b) => b.type === 'itemize' && (b.items || []).length > 0);
      if (paraB && listB) page = { index: p.index, paraId: paraB.id, listId: listB.id, slideId: p.slide.id };
    });
    if (!page) return { error: 'no page with plain paragraph + itemize found' };
    // updateBlock 是不可变更新：必须每次从 store 现取，持有旧快照读到的永远是改前值
    const slideOf = () => st.getState().computed.pages
      .find((p) => p.kind === 'slide' && p.slide?.id === page.slideId)?.slide;
    const orderOf = (bid) => slideOf()?.blocks.find((b) => b.id === bid)?.order;
    const itemOrderOf = (bid, i) => slideOf()?.blocks.find((b) => b.id === bid)?.itemOrders?.[i];
    const pickerCount = () => document.querySelectorAll('.ord-picker').length;
    const badgeOf = (bid) => document.querySelector(`.editor-canvas [data-bid="${bid}"] .ord-badge`);
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const clearCell = () => document.querySelector('.ord-picker .op-clear');

    st.getState().gotoPage(page.index, false);
    await sleep(600);

    // 1) 徽章存在性：未设序 → ⏱、无 set 类
    step = 'badgeAffordance';
    const badge = badgeOf(page.paraId);
    out.badgeAffordance = {
      exists: !!badge, text: badge?.textContent,
      pass: !!badge && badge.textContent === '⏱' && !badge.classList.contains('set'),
    };
    if (!badge) return out;

    // 2) 弹出与网格结构：取消+1~9 共 10 格 + 输入行；未设序时「取消」高亮
    step = 'pickerGrid';
    click(badge);
    await sleep(350);
    const picker = document.querySelector('.ord-picker');
    const cells = [...document.querySelectorAll('.ord-picker .op-cell')];
    out.pickerGrid = {
      opened: !!picker,
      cells: cells.map((c) => c.textContent),
      clearCur: cells[0]?.classList.contains('cur') ?? false,
      hasInput: !!document.querySelector('.ord-picker .op-input'),
      pass: !!picker && cells.length === 10 && cells[0].textContent === '取消'
        && cells.slice(1).map((c) => c.textContent).join('') === '123456789'
        && cells[0].classList.contains('cur') && !!document.querySelector('.ord-picker .op-input'),
    };
    if (!picker) return out;

    // 3) 选择器内部点击不穿透（不进编辑态、不关选择器）
    step = 'insideClickNoEdit';
    picker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    click(picker);
    await sleep(200);
    out.insideClickNoEdit = {
      editing: st.getState().editing, stillOpen: pickerCount() === 1,
      pass: st.getState().editing === null && pickerCount() === 1,
    };

    // 4) 点 3 → order=3、选择器关、徽章常驻数字
    step = 'quickPick';
    click(cells[3]); // cells[0]=取消，cells[3]=「3」
    await sleep(300);
    const badgeSet = badgeOf(page.paraId);
    out.quickPick = {
      order: orderOf(page.paraId), closed: pickerCount() === 0,
      badge: badgeSet?.textContent, badgeSet: badgeSet?.classList.contains('set') ?? false,
      pass: orderOf(page.paraId) === 3 && pickerCount() === 0
        && badgeSet?.textContent === '3' && badgeSet.classList.contains('set'),
    };

    // 5) 重开：3 高亮；点「取消」→ 清除
    step = 'clearPick';
    click(badgeOf(page.paraId));
    await sleep(300);
    const cur3 = [...document.querySelectorAll('.ord-picker .op-cell')].find((c) => c.textContent === '3');
    const curHl = cur3?.classList.contains('cur') ?? false;
    click(clearCell());
    await sleep(300);
    out.clearPick = {
      curHighlighted: curHl, order: orderOf(page.paraId), closed: pickerCount() === 0,
      badgeBack: badgeOf(page.paraId)?.textContent,
      pass: curHl && orderOf(page.paraId) == null && pickerCount() === 0
        && badgeOf(page.paraId)?.textContent === '⏱',
    };

    // 6) 列表项：⏱ → 输入行键入 2 回车 → itemOrders[0]=2；重开点「取消」清除
    step = 'itemInputPick';
    const liOrd = document.querySelector(`.editor-canvas [data-bid="${page.listId}"] .li-ord`);
    if (!liOrd) { out.itemInputPick = { error: 'li-ord not found' }; return out; }
    click(liOrd);
    await sleep(300);
    const input = document.querySelector('.ord-picker .op-input');
    if (!input) { out.itemInputPick = { error: 'picker input not found' }; return out; }
    input.value = '2'; // 非受控输入：直接赋值即可，commitInput 读 DOM 值
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(300);
    const liAfter = document.querySelector(`.editor-canvas [data-bid="${page.listId}"] .li-ord`);
    const itemSet = itemOrderOf(page.listId, 0) === 2 && pickerCount() === 0
      && liAfter?.textContent === '2' && liAfter.classList.contains('set');
    click(liAfter);
    await sleep(300);
    click(clearCell());
    await sleep(300);
    out.itemInputPick = {
      itemSet, afterClear: itemOrderOf(page.listId, 0),
      pass: itemSet && itemOrderOf(page.listId, 0) == null && pickerCount() === 0,
    };

    // 7) 单开语义：段落块选择器开着，点列表块徽章 → 仍仅一层
    step = 'singleOpen';
    click(badgeOf(page.paraId));
    await sleep(300);
    click(badgeOf(page.listId));
    await sleep(300);
    out.singleOpen = { count: pickerCount(), pass: pickerCount() === 1 };

    // 8a) 外点 mousedown 关闭且不篡值；8b) 画布 wheel 关闭
    step = 'outsideClose';
    document.querySelector('.editor-canvas').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await sleep(250);
    const closedByDown = pickerCount() === 0;
    click(badgeOf(page.listId));
    await sleep(300);
    document.querySelector('.editor-canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    await sleep(250);
    out.outsideCloseKeepsValue = {
      closedByDown, closedByWheel: pickerCount() === 0,
      paraOrder: orderOf(page.paraId), listOrder: orderOf(page.listId),
      pass: closedByDown && pickerCount() === 0 && orderOf(page.paraId) == null && orderOf(page.listId) == null,
    };

    // 9) 列表块车位：块徽章（in-list 左移）与首项 li-ord 的包围盒不得相交
    step = 'badgeLaneClearance';
    const lb = badgeOf(page.listId)?.getBoundingClientRect();
    const li0 = document.querySelector(`.editor-canvas [data-bid="${page.listId}"] .li-ord`)?.getBoundingClientRect();
    const overlap = lb && li0
      ? lb.left < li0.right && lb.right > li0.left && lb.top < li0.bottom && lb.bottom > li0.top
      : true;
    out.badgeLaneClearance = {
      shifted: badgeOf(page.listId)?.classList.contains('in-list') ?? false,
      overlap,
      pass: !!lb && !!li0 && !overlap && (badgeOf(page.listId)?.classList.contains('in-list') ?? false),
    };

    return out;
  } catch (e) {
    return { ...out, failedAt: step, error: String(e && e.stack ? e.stack : e) };
  }
})()
