// E2E 验证：着色段落编辑态不漏源码（第卅一轮修复）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2500);
  const r = await window.api.readFile('E:/projects/ai/BeamerApp/examples/zh_talk/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/projects/ai/BeamerApp/examples/zh_talk' });
  await sleep(2600);

  const out = {};
  // 用户场景 A：span 内容含硬换行（旧：编辑态整段漏源码）
  const TEXT_A = '[方法一（数值计算-积分）：\n直接数值积分]{color=primary} 计算 $I=\\int_0^1 f(x)\\,dx$';
  // 场景 B：粗体包着色嵌套（旧：内层漏源码）
  const TEXT_B = '**[关键假设]{color=accent}** 由此推出';
  // 场景 C：普通着色（回归对照）
  const TEXT_C = '[着色]{color=emphasis} 正常';

  const s = st.getState();
  const idx = s.computed.pages.findIndex((p) => p.slide?.blocks?.some((b) => b.type === 'paragraph'));
  const page = s.computed.pages[idx];
  const para = page.slide.blocks.find((b) => b.type === 'paragraph');
  s.updateBlock(page.slide.id, para.id, { text: TEXT_A });

  // 展示态对照：三段都渲染为着色
  st.getState().gotoPage(idx);
  await sleep(600);
  const dispSpan = document.querySelector('.page-wrap .para [data-color-role]');
  out.displayColored = !!dispSpan;
  out.displayHasMath = !!document.querySelector('.page-wrap .para .imath .katex');

  // 编辑态：场景 A
  st.getState().setEditing({ slideId: page.slide.id, blockId: para.id });
  await sleep(1000);
  const pm = document.querySelector('.page-wrap .block-editor-wrap .ProseMirror');
  out.pmMounted = !!pm;
  if (pm) {
    out.rawLeakA = pm.textContent.includes('{color=');
    out.coloredInEdit = !!pm.querySelector('[data-color-role]');
    out.hardBreak = !!pm.querySelector('br');
    out.mathChip = !!pm.querySelector('[data-inline-math]');
  }
  st.getState().setEditing(null);
  await sleep(400);

  // 编辑态：场景 B（粗体嵌套）
  s.updateBlock(page.slide.id, para.id, { text: TEXT_B });
  await sleep(500);
  st.getState().setEditing({ slideId: page.slide.id, blockId: para.id });
  await sleep(1000);
  const pm2 = document.querySelector('.page-wrap .block-editor-wrap .ProseMirror');
  if (pm2) {
    out.rawLeakB = pm2.textContent.includes('{color=');
    out.boldColored = !!pm2.querySelector('strong [data-color-role], [data-color-role] strong');
    out.boldMark = !!pm2.querySelector('strong');
  }
  st.getState().setEditing(null);
  await sleep(400);

  // 编辑态：场景 C（回归对照）
  s.updateBlock(page.slide.id, para.id, { text: TEXT_C });
  await sleep(500);
  st.getState().setEditing({ slideId: page.slide.id, blockId: para.id });
  await sleep(1000);
  const pm3 = document.querySelector('.page-wrap .block-editor-wrap .ProseMirror');
  if (pm3) {
    out.rawLeakC = pm3.textContent.includes('{color=');
    out.coloredC = !!pm3.querySelector('[data-color-role]');
  }
  st.getState().setEditing(null);
  await sleep(300);

  // 序列化往返：编辑一次（模拟击键触发 onUpdate）后 md 数据稳定
  const finalText = st.getState().deck.items
    .find((it) => it.kind === 'slide' && it.slide.id === page.slide.id);
  out.storedText = finalText && finalText.kind === 'slide'
    ? finalText.slide.blocks.find((b) => b.id === para.id)?.text
    : null;
  return out;
})()
