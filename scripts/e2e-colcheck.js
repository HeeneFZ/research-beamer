// E2E 验证（第卅七轮）：双栏栏宽对称 + 结束双栏区语义
// 1) 栏宽：twoCol 页左右栏渲染宽度 = ratio·(W−g) 与 (1−ratio)·(W−g)（默认 ratio=0.5 → 两栏相等）
// 2) colend：右栏末尾插公式块 → 点「结束双栏区」→ 公式块逃出栏区变单栏（全宽），
//    其后插入的新段落也落单栏；分割线（编辑态栏区边界提示）渲染
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => st.getState();
  const out = {};

  await sleep(2600);

  // ---- 1) 栏宽 ----
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
  // 测量一律用布局级 CSS px（getComputedStyle），画布 transform scale 不掺入
  const cssW = (el) => parseFloat(getComputedStyle(el).width);
  const lw = cssW(colL);
  const rw = cssW(colR);
  const total = cssW(colsEl);
  const gap = parseFloat(getComputedStyle(colsEl).gap) || 0;
  // 修复契约：左 = ratio·(W−g)、右 = (1−ratio)·(W−g)；左+距+右 = 容器宽（无泄漏）
  const avail = total - gap;
  out.colWidths = {
    ratio, total: +total.toFixed(1), gap: +gap.toFixed(1),
    left: +lw.toFixed(1), right: +rw.toFixed(1),
    sumCheck: +(lw + gap + rw).toFixed(1),
    expectL: +(avail * ratio).toFixed(1), expectR: +(avail * (1 - ratio)).toFixed(1),
    // 用户合约：默认页（ratio=0.5）两栏渲染宽度相等
    equalWidths: Math.abs(lw - rw) < 0.5,
    pass: Math.abs(lw - avail * ratio) < 0.5 && Math.abs(rw - avail * (1 - ratio)) < 0.5 && Math.abs(lw + gap + rw - total) < 0.5,
  };
  if (ratio === 0.5 && !out.colWidths.equalWidths) out.colWidths.pass = false;

  const colsCs = getComputedStyle(colsEl, '::before');
  out.divider = {
    content: colsCs.content,
    border: colsCs.borderTopStyle,
    // 0.5px 物理线（高 DPI 下计算样式 ≤0.8px）+ α .16 高透明度灰
    pass: colsCs.borderTopStyle === 'solid' && parseFloat(colsCs.borderTopWidth) <= 0.8 && /rgba\(90, 100, 112, 0\.16\)/.test(colsCs.borderTopColor),
  };

  // ---- 2) colend：公式块逃出栏区 ----
  const slideOf = () => {
    const d = state().deck;
    const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slide.id);
    return it.kind === 'slide' ? it.slide : null;
  };
  const blocks0 = slideOf().blocks;
  const lastBlk = blocks0[blocks0.length - 1];
  const eqId = state().insertBlock(slide.id, lastBlk.id, 'equation', { latex: 'E = mc^2' });
  state().setEditing(null);
  await sleep(1200);

  const eqEl = () => document.querySelector(`.editor-canvas [data-bid="${eqId}"]`);
  out.before = {
    inColR: !!eqEl()?.closest('.col-r'),
    width: +eqEl().getBoundingClientRect().width.toFixed(1),
  };

  // 真实 UI 路径：悬停 → ＋ →「结束双栏区」
  eqEl().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(500);
  const bar = document.querySelector('.btools-float');
  const plus = bar && [...bar.querySelectorAll('button')].find((b) => /＋/.test(b.textContent));
  plus?.click();
  await sleep(300);
  const menu = document.querySelector('.btools-menu-float');
  const endBtn = menu && [...menu.querySelectorAll('.ref-picker-item')].find((x) => x.textContent.includes('结束双栏区'));
  endBtn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(1200);

  const bodyEl = document.querySelector('.editor-canvas .s-body');
  const bodyCs = getComputedStyle(bodyEl);
  const bodyContentW = parseFloat(bodyCs.width) - parseFloat(bodyCs.paddingLeft) - parseFloat(bodyCs.paddingRight);
  out.after = {
    inColR: !!eqEl()?.closest('.col-r'),
    inCols: !!eqEl()?.closest('.cols'),
    width: +getComputedStyle(eqEl()).width.replace('px', ''),
    bodyContentW: +bodyContentW.toFixed(1),
    blocks: slideOf().blocks.map((b) => b.type + (b.id === eqId ? '#EQ' : '')),
    editing: state().editing,
  };
  out.after.pass = !out.after.inCols && Math.abs(out.after.width - bodyContentW) < 1 && out.after.editing == null;

  // 其后插入段落应落单栏（colend 之后）
  const paraId = state().insertBlock(slide.id, eqId, 'paragraph', { text: '尾段' });
  await sleep(1000);
  const paraEl = document.querySelector(`.editor-canvas [data-bid="${paraId}"]`);
  out.afterInsert = {
    inCols: !!paraEl?.closest('.cols'),
    pass: !paraEl?.closest('.cols'),
  };

  // 「结束双栏区」菜单项对栏外块应禁用
  paraEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(500);
  const bar2 = document.querySelector('.btools-float');
  const plus2 = bar2 && [...bar2.querySelectorAll('button')].find((b) => /＋/.test(b.textContent));
  plus2?.click();
  await sleep(300);
  const menu2 = document.querySelector('.btools-menu-float');
  const endItem2 = menu2 && [...menu2.querySelectorAll('.ref-picker-item')].find((x) => x.textContent.includes('结束双栏区'));
  out.colEndDisabledOutside = endItem2 ? {
    cls: endItem2.className,
    pass: /disabled/.test(endItem2.className),
  } : { pass: false, error: 'menu item not found' };

  return out;
})()
