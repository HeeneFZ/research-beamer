// E2E：标题行内公式全链路（第卌九轮）
// ① setConfig/slide title/节名带 $..$ → 封面/页眉/分隔页/目录 KaTeX 渲染
// ② 封面大标题编辑器：TipTap 挂载 → 键入 $$ 生成空芯片 + 弹浮层 → 浮层输入 → Enter 提交
// ③ 帧标题编辑器（TitleEditor）挂载；④ md 序列化往返（serializeMarkdown 落盘格式）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  await sleep(2500);

  const r = await window.api.readFile('E:/projects/ai/BeamerApp/examples/zh_talk/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/projects/ai/BeamerApp/examples/zh_talk' });
  await sleep(2600);

  // ① 渲染：封面大标题
  st.getState().setConfig({ title: '基于 $\\mathcal{D}_{\\text{tex}}$ 的排版研究' });
  await sleep(500);
  const cover = document.querySelector('.sv .cover-title');
  out.coverHasKatex = !!cover?.querySelector('.imath .katex');
  out.coverText = (cover?.textContent ?? '').trim();

  // ① 渲染：页眉帧标题（示例自带数学标题页）
  const s0 = st.getState();
  const aidx = s0.computed.pages.findIndex((p) => p.slide?.title?.includes('$'));
  out.archIdx = aidx;
  if (aidx >= 0) {
    st.getState().gotoPage(aidx);
    await sleep(500);
    // 画布页（.page-wrap 内）才是当前页——胶片缩略图同样渲染 .sv/.s-title
    const stEl = document.querySelector('.page-wrap .s-title');
    out.frameHasKatex = !!stEl?.querySelector('.imath .katex');
    out.frameText = (stEl?.textContent ?? '').trim();
  }

  // ① 渲染：节标题（改名注入公式）→ 分隔页 + 目录
  const sec = st.getState().deck.items.find((it) => it.kind === 'section');
  st.getState().renameSection(sec.section.id, '方法 $E=mc^2$');
  await sleep(600);
  const c1 = st.getState().computed;
  const didx = c1.pages.findIndex((p) => p.kind === 'divider' && p.section?.id === sec.section.id);
  st.getState().gotoPage(didx);
  await sleep(500);
  const dt = document.querySelector('.sv .divider-title');
  out.dividerHasKatex = !!dt?.querySelector('.imath .katex');
  out.dividerText = (dt?.textContent ?? '').trim();
  const tidx = c1.pages.findIndex((p) => p.slide?.layout === 'toc');
  st.getState().gotoPage(tidx);
  await sleep(600);
  const tocEl = document.querySelector('.sv .toc-title');
  out.tocHasKatex = !!tocEl?.querySelector('.imath .katex');
  out.tocText = (tocEl?.textContent ?? '').trim();

  // ② 封面大标题 $$ 交互
  st.getState().gotoPage(0);
  await sleep(500);
  const coverSlide = st.getState().computed.pages[0].slide;
  st.getState().setEditing({ slideId: coverSlide.id, field: 'coverTitle' });
  await sleep(800);
  const pm = document.querySelector('.cover-title .ProseMirror');
  out.pmMounted = !!pm;
  if (pm) {
    pm.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(pm);
    document.execCommand('insertText', false, '基于 ');
    await sleep(200);
    document.execCommand('insertText', false, '$$');
    await sleep(600);
    out.emptyChip = !!pm.querySelector('[data-inline-math]');
    out.floatOpen = !!document.querySelector('.math-float');
    const ta = document.querySelector('.math-float .lx-input');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '\\alpha+\\beta');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(500);
    }
    out.floatCommitted = !!pm.querySelector('.inline-math-node .katex');
    // 浮层关闭后继续键入正文，Enter 收场
    pm.focus();
    document.execCommand('insertText', false, ' 的研究');
    await sleep(300);
    pm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(500);
    out.titleAfterEdit = st.getState().deck.config.title;
    // 编辑态收起后封面应渲染公式
    const cover2 = document.querySelector('.sv .cover-title');
    out.coverRendersAfterEdit = !!cover2?.querySelector('.imath .katex');
  }

  // ③ 帧标题编辑器挂载（TitleEditor TipTap 化）
  const s2 = st.getState();
  const tidx2 = s2.computed.pages.findIndex((p) => p.slide?.layout === 'content');
  st.getState().gotoPage(tidx2);
  await sleep(400);
  const cslide = st.getState().computed.pages[tidx2].slide;
  st.getState().setEditing({ slideId: cslide.id, field: 'title' });
  await sleep(700);
  out.titlePmMounted = !!document.querySelector('.s-title .ProseMirror');
  st.getState().setEditing(null);
  await sleep(200);

  // ⑤ 字段直切语义：大标题编辑中编辑态切到作者字段 →
  //    作者 input 应挂载、标题经卸载兜底提交、>150ms 后作者编辑不被失焦通道关掉
  st.getState().gotoPage(0);
  await sleep(400);
  const coverSlide2 = st.getState().computed.pages[0].slide;
  st.getState().setEditing({ slideId: coverSlide2.id, field: 'coverTitle' });
  await sleep(700);
  const pm2 = document.querySelector('.cover-title .ProseMirror');
  if (pm2) {
    pm2.focus();
    document.execCommand('insertText', false, '标题直切A');
    await sleep(400);
    out.titleLiveCommitted = st.getState().deck.config.title.includes('标题直切A');
    // 直接切字段（等价于用户点击作者字段的 setEditing 效果）
    st.getState().setEditing({ slideId: coverSlide2.id, field: 'coverAuthors' });
    await sleep(700); // > 失焦延迟 150ms
    out.switchAuthorsOpen = !!document.querySelector('.cover-authors input');
    out.switchTitleKept = st.getState().deck.config.title.includes('标题直切A');
    st.getState().setEditing(null);
    await sleep(200);
  }

  // ④ 数据断言：标题公式源在 deck 数据中保留（序列化合约由 vitest 覆盖）
  const s3 = st.getState();
  out.deckTitle = s3.deck.config.title;
  out.slideTitleWithMath = s3.deck.items.some((it) => it.kind === 'slide' && /\\mathcal\{C\}/.test(it.slide.title || ''));
  out.sectionTitleWithMath = s3.deck.items.some((it) => it.kind === 'section' && it.section.title.includes('$E=mc^2$'));
  return out;
})()
