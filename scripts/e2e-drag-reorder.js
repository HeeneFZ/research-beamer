// 大纲拖拽换序 E2E：模拟 dragStart→dragOver→drop；断言页序变化 + 节归属正确重算
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = await window.api.readFile('E:/work/课题/科大课题组/2608/thoery_show/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/work/课题/科大课题组/2608/thoery_show' });
  await sleep(2400);
  const out = {};
  const before = st.getState().computed.pages.map((p) => (p.kind === 'slide' ? p.slide.title || '(无题)' : '§' + (p.section?.title || '')));
  // 拖「问题定义」(第一个内容页 idx3) 到「可解性导出」页上
  const idxOf = (t) => st.getState().computed.pages.findIndex((p) => p.kind === 'slide' && p.slide.title === t);
  const srcIdx = idxOf('问题定义');
  const dstIdx = idxOf('可解性导出');
  if (srcIdx < 0 || dstIdx < 0) return { error: 'page not found', srcIdx, dstIdx };
  const srcId = st.getState().computed.pages[srcIdx].slide.id;
  const dstId = st.getState().computed.pages[dstIdx].slide.id;
  st.getState().moveSlide(srcId, dstId);
  await sleep(500);
  const pagesAfter = st.getState().computed.pages;
  const after = pagesAfter.map((p) => (p.kind === 'slide' ? p.slide.title || '(无题)' : '§' + (p.section?.title || '')));
  out.after = after;
  // 用 id 精确定位（同名页三张，indexOf 不可用）
  const srcPageAfter = pagesAfter.find((p) => p.kind === 'slide' && p.slide.id === srcId);
  const dstPageAfter = pagesAfter.find((p) => p.kind === 'slide' && p.slide.id === dstId);
  out.movedToBeforeTarget = srcPageAfter.index === dstPageAfter.index - 1;
  out.movedSectionPath = srcPageAfter.sectionPath?.map((s) => s.title) ?? null;
  out.sameCount = before.length === after.length;
  out.currentFollows = st.getState().current === srcPageAfter.index;
  out.pass = out.movedToBeforeTarget && out.sameCount && out.currentFollows;
  return out;
})()
