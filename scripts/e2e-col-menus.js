// 双栏区入口补全验证：① 空页「＋添加内容」菜单含 开始/结束双栏区，选「开始双栏区」
// 建出 colmark+左右空段且光标落左栏；② 文本块 "/" 斜杠菜单含 开始/结束双栏区，
// 选「开始双栏区」在当前块之后开栏；栏内块菜单的「结束双栏区」可点、栏外 disable。
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const type = async (s) => { document.execCommand('insertText', false, s); await sleep(250); };
  const out = {};
  st.getState().newProject();
  await sleep(1500);

  // ---------- ① 空页首块菜单 ----------
  const emptyIdx = st.getState().computed.pages.findIndex(
    (p) => p.kind === 'slide' && (p.slide?.blocks || []).length === 0 && p.slide?.layout === 'content',
  );
  if (emptyIdx < 0) return { error: 'no empty content page' };
  st.getState().gotoPage(emptyIdx);
  await sleep(900);
  const sv = document.querySelector('.sv.mode-edit');
  const btn = sv.querySelector('.add-first-btn');
  btn.click();
  await sleep(300);
  const menu = document.querySelector('.add-first-menu');
  out.firstItemCount = menu ? menu.querySelectorAll('.ref-picker-item').length : 0;
  out.firstHasColMark = !!([...menu.querySelectorAll('.ref-picker-item')].find((el) => el.textContent.includes('开始双栏区')));
  const firstColEnd = [...menu.querySelectorAll('.ref-picker-item')].find((el) => el.textContent.includes('结束双栏区'));
  out.firstColEndDisabled = firstColEnd ? firstColEnd.classList.contains('disabled') : null;
  const colMarkItem = [...menu.querySelectorAll('.ref-picker-item')].find((el) => el.textContent.includes('开始双栏区'));
  colMarkItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(500);
  let page = st.getState().computed.pages[st.getState().current];
  out.afterFirstBlocks = (page.slide?.blocks || []).map((b) => b.type);
  out.firstColRegionOk = JSON.stringify(out.afterFirstBlocks) === JSON.stringify(['colmark', 'paragraph', 'colmark', 'paragraph']);
  // 开栏后光标应落左栏段落（焦点桥修复 + col-l 容器）
  out.focusInLeftCol = (() => {
    const ed = document.querySelector('.block-editor-wrap .ProseMirror');
    return !!ed && !!ed.closest('.col-l');
  })();

  // ---------- ② 斜杠菜单（左栏空段内输入 / ）----------
  st.getState().setEditing(null);
  st.getState().setFocus(null);
  await sleep(300);
  page = st.getState().computed.pages[st.getState().current];
  const leftPara = (page.slide?.blocks || []).find((b) => b.type === 'paragraph');
  st.getState().setEditing({ slideId: page.slide.id, blockId: leftPara.id });
  await sleep(500);
  const pm = document.querySelector('.block-editor-wrap .ProseMirror');
  if (!pm) return { ...out, error: 'no ProseMirror' };
  pm.focus();
  // canTrigger 要求 / 前是空白/CJK：空段先输入空格再 /
  await type(' ');
  await type('/');
  await sleep(400);
  const slashMenu = document.querySelector('.slash-menu');
  out.slashAppeared = !!slashMenu;
  if (!slashMenu) return { ...out, error: 'no slash menu' };
  out.slashHasColMark = !!([...slashMenu.querySelectorAll('.slash-item')].find((el) => el.textContent.includes('开始双栏区')));
  const slashColEnd = [...slashMenu.querySelectorAll('.slash-item')].find((el) => el.textContent.includes('结束双栏区'));
  // 左栏段落在栏区内 → 结束双栏区应可用（非 disabled）
  out.slashColEndEnabledInCol = slashColEnd ? !slashColEnd.classList.contains('disabled') : null;
  const slashColMarkItem = [...slashMenu.querySelectorAll('.slash-item')].find((el) => el.textContent.includes('开始双栏区'));
  slashColMarkItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(800);
  page = st.getState().computed.pages[st.getState().current];
  out.afterSlashBlocks = (page.slide?.blocks || []).map((b) => b.type);
  // 栏区内开新栏区：让位到栏区终结处（页尾），两组 colmark（4 个标记）
  out.slashColRegionOk = out.afterSlashBlocks.filter((t) => t === 'colmark').length === 4;

  // ---------- ③ 栏外块的斜杠菜单：结束双栏区应 disable ----------
  st.getState().setEditing(null);
  await sleep(300);
  // ---------- ③ 栏外块的斜杠菜单：结束双栏区应 disable ----------
  // 新建无栏区内容页（收栏删标记后前栏区会重新延伸吞尾，本页不适合做栏外判定）
  st.getState().addSlide('content', st.getState().current);
  await sleep(400);
  const s = st.getState();
  const cur = s.computed.pages[s.current];
  const nid = s.insertBlock(cur.slide.id, null, 'paragraph', { text: '外' });
  s.setEditing({ slideId: cur.slide.id, blockId: nid });
  await sleep(500);
  const pm2 = document.querySelector('.block-editor-wrap .ProseMirror');
  if (!pm2) return { ...out, error: 'no ProseMirror 2' };
  pm2.focus();
  // 光标移到文本尾（中文「外」满足 canTrigger）再输入 /
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(pm2);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  await type('/');
  await sleep(400);
  const slashMenu2 = document.querySelector('.slash-menu');
  const slashColEnd2 = slashMenu2 ? [...slashMenu2.querySelectorAll('.slash-item')].find((el) => el.textContent.includes('结束双栏区')) : null;
  out.slashColEndDisabledOutside = slashColEnd2 ? slashColEnd2.classList.contains('disabled') : null;
  out.slashMenu2Appeared = !!slashMenu2;

  out.pass = out.firstHasColMark && out.firstColEndDisabled === true && out.firstColRegionOk
    && out.focusInLeftCol && out.slashAppeared && out.slashHasColMark && out.slashColEndEnabledInCol
    && out.slashColRegionOk && out.slashColEndDisabledOutside === true;
  return out;
})()
