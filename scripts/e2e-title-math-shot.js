// 截图验证：标题行内公式的四个渲染语境（封面/页眉/分隔页/目录）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2500);
  const r = await window.api.readFile('E:/projects/ai/BeamerApp/examples/zh_talk/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/projects/ai/BeamerApp/examples/zh_talk' });
  await sleep(2600);
  st.getState().setConfig({ title: '基于 $\\mathcal{D}_{\\mathrm{tex}}$ 的科技文本自动排版方法' });
  await sleep(500);
  const sec = st.getState().deck.items.find((it) => it.kind === 'section');
  st.getState().renameSection(sec.section.id, '方法 $E=mc^2$');
  await sleep(500);
  window.__shotSeq = [
    { name: 'cover-title-math', wait: 700, run: () => {} },,
    {
      name: 'frame-title-math',
      wait: 700,
      run: () => {
        const s = window.__store.getState();
        const i = s.computed.pages.findIndex((p) => p.slide?.title?.includes('$'));
        s.gotoPage(i);
      },
    },
    {
      name: 'divider-title-math',
      wait: 700,
      run: () => {
        const s = window.__store.getState();
        const i = s.computed.pages.findIndex((p) => p.kind === 'divider');
        s.gotoPage(i);
      },
    },
    {
      name: 'toc-title-math',
      wait: 700,
      run: () => {
        const s = window.__store.getState();
        const i = s.computed.pages.findIndex((p) => p.slide?.layout === 'toc');
        s.gotoPage(i);
      },
    },
  ];
  return { ok: true };
})()
