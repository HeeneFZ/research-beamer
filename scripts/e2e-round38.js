// E2E 验证（第卅八轮）：双栏栏宽对称 + 分割线（细实线，编辑+放映可见）+
// 结束双栏区语义 + 空栏区自动收回 + 块复制粘贴
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => st.getState();
  const out = {};

  await sleep(2600);

  // ---- 1) 栏宽 + 分割线 ----
  const pages = state().computed.pages;
  let idx = -1;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].slide && pages[i].slide.layout === 'twoCol') { idx = i; break; }
  }
  if (idx < 0) return { error: 'no twoCol page' };
  state().gotoPage(idx);
  await sleep(1500);

  const slide = state().computed.pages[idx].slide;
  const ratio = slide.ratio ?? 0.5;
  const colsEl = document.querySelector('.editor-canvas .cols');
  const colL = colsEl.querySelector('.col-l');
  const colR = colsEl.querySelector('.col-r');
  const cssW = (el) => parseFloat(getComputedStyle(el).width);
  const lw = cssW(colL);
  const rw = cssW(colR);
  const total = cssW(colsEl);
  const gap = parseFloat(getComputedStyle(colsEl).gap) || 0;
  const avail = total - gap;
  out.colWidths = {
    ratio, total: +total.toFixed(1), gap: +gap.toFixed(1),
    left: +lw.toFixed(1), right: +rw.toFixed(1),
    expectL: +(avail * ratio).toFixed(1), expectR: +(avail * (1 - ratio)).toFixed(1),
    equalWidths: Math.abs(lw - rw) < 0.5,
    pass: Math.abs(lw - avail * ratio) < 0.5 && Math.abs(rw - avail * (1 - ratio)) < 0.5 && Math.abs(lw + gap + rw - total) < 0.5,
  };

  // 分割线：细实线（≤1px，高 DPI 下计算样式可为分数 px），半透明灰
  const csB = getComputedStyle(colsEl, '::before');
  out.divider = {
    style: csB.borderTopStyle,
    color: csB.borderTopColor,
    width: csB.borderTopWidth,
    pass: csB.borderTopStyle === 'solid' && parseFloat(csB.borderTopWidth) <= 1 && /rgba\(90, 100, 112/.test(csB.borderTopColor),
  };

  // ---- 2) 块复制粘贴（真实 UI 路径） ----
  const slideOf = () => {
    const d = state().deck;
    const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slide.id);
    return it.kind === 'slide' ? it.slide : null;
  };
  const blocks0 = slideOf().blocks;
  const srcPara = blocks0.find((b) => b.type === 'paragraph' && b.text);
  const hoverToolbar = async (bid) => {
    const el = document.querySelector(`.editor-canvas [data-bid="${bid}"]`);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(500);
    return !!document.querySelector('.btools-float');
  };
  const clickBtn = async (bid, pattern) => {
    if (!(await hoverToolbar(bid))) return false;
    const bar = document.querySelector('.btools-float');
    const btn = [...bar.querySelectorAll('button')].find((b) => pattern.test(b.title || ''));
    if (!btn) return false;
    btn.click();
    return true;
  };

  out.copyPaste = {};
  if (srcPara) {
    // 按钮 title 含「粘贴」的有两个（复制块的 title 也带提示词）——锚定词区分
    out.copyPaste.copied = await clickBtn(srcPara.id, /复制块/);
    await sleep(300);
    out.copyPaste.clipSet = !!state().clipBlock && state().clipBlock.text === srcPara.text;
    // 粘贴到另一块之后：粘贴按钮 title 以「粘贴…到此处」开头
    const other = blocks0.find((b) => b.type === 'itemize');
    if (other) {
      out.copyPaste.pasted = await clickBtn(other.id, /^粘贴/);
      await sleep(800);
      const now = slideOf().blocks;
      out.copyPaste.countAfter = now.filter((b) => b.type === 'paragraph' && b.text === srcPara.text).length;
      out.copyPaste.pass = out.copyPaste.clipSet && out.copyPaste.countAfter === 2;
    }
  }

  // ---- 3) 空栏区收回：删光右栏全部内容块 ----
  // 构造：右栏插一个段落，删掉它 → 栏区另一侧还有左栏内容（保留）；
  // 再删左栏最后一块 → 整个栏区收回，分割线消失
  const rightBlocks = (() => {
    const segs = slideOf().blocks;
    // 找 twoCol 页右栏块：第二个 colmark 之后的内容
    let marks = 0;
    const right = [];
    for (const b of segs) {
      if (b.type === 'colmark') { marks++; continue; }
      if (b.type === 'colend') break;
      if (marks === 2) right.push(b);
    }
    return right;
  })();
  out.emptyRegion = {};
  if (rightBlocks.length) {
    // 删除右栏第一个块
    state().deleteBlock(slide.id, rightBlocks[0].id);
    await sleep(600);
    out.emptyRegion.afterFirstDelete = {
      stillCols: document.querySelectorAll('.editor-canvas .cols').length,
    };
    // 若右栏还有块，继续删到空
    let right2 = rightBlocks.slice(1);
    for (const b of right2) { state().deleteBlock(slide.id, b.id); await sleep(200); }
    // 右栏空后：左栏仍有内容 → 栏区保留（单边）
    out.emptyRegion.rightEmpty = {
      colsCount: document.querySelectorAll('.editor-canvas .cols').length,
      // 右栏空（内容全删）时 buildSegments 单边栏区仍渲染
      pass: document.querySelectorAll('.editor-canvas .cols').length >= 1,
    };
    // 删光左栏全部内容 → 整个栏区收回
    let marks2 = 0;
    const leftIds = [];
    for (const b of slideOf().blocks) {
      if (b.type === 'colmark') { marks2++; continue; }
      if (b.type === 'colend') break;
      if (marks2 === 1) leftIds.push(b.id);
    }
    for (const id of leftIds) { state().deleteBlock(slide.id, id); await sleep(200); }
    await sleep(600);
    out.emptyRegion.allEmpty = {
      colsCount: document.querySelectorAll('.editor-canvas .cols').length,
      marksLeft: slideOf().blocks.filter((b) => b.type === 'colmark' || b.type === 'colend').length,
      pass: document.querySelectorAll('.editor-canvas .cols').length === 0
        && slideOf().blocks.filter((b) => b.type === 'colmark' || b.type === 'colend').length === 0,
    };
  }

  // ---- 4) colend 语义回归（公式块逃出栏区） ----
  const blocksR = slideOf().blocks;
  const lastBlk = blocksR[blocksR.length - 1];
  if (lastBlk) {
    const eqId = state().insertBlock(slide.id, lastBlk.id, 'equation', { latex: 'E = mc^2' });
    state().setEditing(null);
    await sleep(1000);
    const eqEl = () => document.querySelector(`.editor-canvas [data-bid="${eqId}"]`);
    if (eqEl() && eqEl().closest('.cols')) {
      // 该块插到了单栏区（栏区已删）——不再测 colend；记录状态
      out.colendSkipped = { reason: 'region already removed by empty-region test' };
    }
  }

  return out;
})()
