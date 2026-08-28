// 页脚附加信息（页级）验证：
// A) 进页脚编辑 → 输入 → 点击画布空白退出 → 本页 slide.footNote 保留
// B) Esc 取消 → 不写入
// C) 全局回退：footNote 清空后显示全局 shortTitle
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = await window.api.readFile('E:/work/课题/科大课题组/2608/thoery_show/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/work/课题/科大课题组/2608/thoery_show' });
  await sleep(2600);
  const out = {};
  // 全局 shortTitle 设基线
  st.getState().setConfig({ shortTitle: '全局页脚XYZ' });
  await sleep(300);
  const idx = st.getState().computed.pages.findIndex((p) => p.kind === 'slide' && (p.slide?.blocks?.length || 0) > 0);
  st.getState().gotoPage(idx);
  await sleep(800);
  const page = st.getState().computed.pages[idx];
  const slideId = page.slide.id;
  // A: 点击外部提交（画布空白 mousedown 清 editing → 卸载兜底）
  st.getState().setEditing({ slideId, field: 'footer' });
  await sleep(400);
  const inp = document.querySelector('.foot-edit');
  if (!inp) return { error: 'no footer input', ...out };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '本页专属ABC');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  document.querySelector('.editor-canvas').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(600);
  const slA = st.getState().deck.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
  out.footNoteAfterClickOutside = slA && slA.kind === 'slide' ? slA.slide.footNote : null;
  out.passA = out.footNoteAfterClickOutside === '本页专属ABC';
  // 渲染层：本页页脚显示页级值；另一页显示全局值
  const el1 = document.querySelector('.sv.mode-edit .s-foot-left');
  out.canvasFootText = el1 ? el1.textContent : null;
  out.passRender = out.canvasFootText === '本页专属ABC';
  // B: Esc 取消（输入不同值但不写入）
  st.getState().setEditing({ slideId, field: 'footer' });
  await sleep(400);
  const inp2 = document.querySelector('.foot-edit');
  setter.call(inp2, '不该出现的值');
  inp2.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  inp2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(400);
  const slB = st.getState().deck.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
  out.footNoteAfterEsc = slB && slB.kind === 'slide' ? slB.slide.footNote : null;
  out.passB = out.footNoteAfterEsc === '本页专属ABC';
  // C: 清空页级 → 回退全局
  st.getState().updateSlide(slideId, { footNote: undefined });
  await sleep(400);
  const el2 = document.querySelector('.sv.mode-edit .s-foot-left');
  out.fallbackText = el2 ? el2.textContent : null;
  out.passC = out.fallbackText === '全局页脚XYZ';
  // 还原
  st.getState().setConfig({ shortTitle: '' });
  out.pass = out.passA && out.passRender && out.passB && out.passC;
  return out;
})()
