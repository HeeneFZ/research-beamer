// 空页首块菜单验证：点按钮弹类型菜单（7 项）→ 选表格 → 建表无残留空段落 → 菜单关闭
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  st.getState().newProject();
  await sleep(1500);
  const emptyIdx = st.getState().computed.pages.findIndex(
    (p) => p.kind === 'slide' && (p.slide?.blocks || []).length === 0 && p.slide?.layout === 'content',
  );
  if (emptyIdx < 0) return { error: 'no empty content page' };
  st.getState().gotoPage(emptyIdx);
  await sleep(900);
  const out = {};
  const sv = document.querySelector('.sv.mode-edit');
  const btn = sv.querySelector('.add-first-btn');
  out.btnExists = !!btn;
  btn.click();
  await sleep(300);
  const menu = sv.querySelector('.add-first-menu');
  out.menuAfterClick = !!menu;
  out.itemCount = menu ? menu.querySelectorAll('.ref-picker-item').length : 0;
  out.passA = out.btnExists && out.menuAfterClick && out.itemCount === 7;
  const items = [...menu.querySelectorAll('.ref-picker-item')];
  const tblItem = items.find((el) => el.textContent.includes('表格'));
  tblItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(700);
  const page = st.getState().computed.pages[emptyIdx];
  const blks = (page.slide?.blocks || []);
  out.afterTableBlocks = blks.map((b) => b.type);
  out.noEmptyParagraph = !blks.some((b) => b.type === 'paragraph' && !b.text);
  out.menuClosedAfterSelect = !document.querySelector('.sv.mode-edit .add-first-menu');
  out.pass = out.passA && blks.some((b) => b.type === 'table') && out.noEmptyParagraph && out.menuClosedAfterSelect;
  return out;
})()
