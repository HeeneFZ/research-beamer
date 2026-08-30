// 栏占位段往返验证：md 中「左栏有字/右栏空」的双栏页，解析后右栏必须带可点击
// 占位段（旧版空段落 serialize 落空行/parse 跳过 → 保存重开一轮后右栏无处落块）
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const MD = [
    '---',
    'beamerapp: 1',
    'title: 往返测试',
    '---',
    '',
    ':::: slide layout="twoCol" ratio="0.5"',
    '::: col',
    '左栏内容',
    '',
    '::: col',
    '::::',
    '',
    ':::: slide layout="twoCol" ratio="0.5"',
    '::: col',
    '::: col',
    '右栏内容',
    '',
    '尾随单栏',
    '::::',
  ].join('\n');
  st.getState().loadProjectData({ md: MD, folder: 'X:/e2e-rt' });
  await sleep(800);
  const pages = st.getState().computed.pages.filter((p) => p.slide?.layout === 'twoCol');
  // 页1：左有字右空 → 右栏补占位
  const p1 = pages[0].slide.blocks.map((b) => b.type);
  out.page1 = p1;
  const sw1 = p1.indexOf('colmark', p1.indexOf('colmark') + 1);
  out.rightReseeded = sw1 >= 0 && p1[sw1 + 1] === 'paragraph';
  // 页2：左空右有字 → 左栏补占位
  const p2 = pages[1].slide.blocks.map((b) => b.type);
  out.page2 = p2;
  const sw2 = p2.indexOf('colmark', p2.indexOf('colmark') + 1);
  out.leftReseeded = sw2 >= 0 && p2[p2.indexOf('colmark') + 1] === 'paragraph';
  // 渲染层：右/左空侧有可点击的空段渲染（buildSegments 不再产出空侧）
  const sv = document.querySelectorAll('.sv.mode-thumb, .sv.mode-edit');
  out.renderedCols = document.querySelectorAll('.cols').length;
  out.emptyParaRendered = document.querySelectorAll('.para-empty').length;
  out.pass = out.rightReseeded && out.leftReseeded && out.renderedCols >= 2;
  return out;
})()
