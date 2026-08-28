// 页脚附加信息（纯页级，无全局回退）验证：
// A) 进页脚编辑 → 输入 → 点击画布空白退出 → 本页 slide.footNote 保留
// B) Esc 取消 → 不写入
// C) 清空 footNote → 本页页脚为空（编辑态显示占位，不回退任何全局值）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = await window.api.readFile('E:/work/课题/科大课题组/2608/thoery_show/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/work/课题/科大课题组/2608/thoery_show' });
  await sleep(2600);
  const out = {};
  // 全局 shortTitle 故意设非空值——验证它不再影响页脚
  st.getState().setConfig({ shortTitle: '全局值不应出现' });
  await sleep(300);
  const idx = st.getState().computed.pages.findIndex((p) => p.kind === 'slide' && (p.slide?.blocks?.length || 0) > 0);
  st.getState().gotoPage(idx);
  await sleep(800);
  const slideId = st.getState().computed.pages[idx].slide.id;
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
  // C: 清空页级 → 页脚为空（无全局回退）；编辑态显示占位
  st.getState().updateSlide(slideId, { footNote: undefined });
  await sleep(400);
  const el2 = document.querySelector('.sv.mode-edit .s-foot-left');
  out.clearedText = el2 ? el2.textContent : null;
  out.passC = out.clearedText === '＋ 页脚信息';
  // 还原现场
  st.getState().setConfig({ shortTitle: '' });
  out.pass = out.passA && out.passRender && out.passB && out.passC;
  return out;
})()
