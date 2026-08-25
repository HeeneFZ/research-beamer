// KaTeX 规则线（分数线/上下划线）的设备像素网格对齐
//
// 问题（第卌二轮实测）：KaTeX 规则线是 0.04em CSS 边框，幻灯片字号（~12px × DPR 1.25
// ≈ 0.59 设备像素宽）下 Chromium 按边框的子像素相位抗锯齿——相位好时压成 1 行浅灰
// （墨迹 117），相位差时摊成 2 行近实心（36%+87%，墨迹 314）；而 =/+ 字形笔画经字体
// hinting 恒定 1 行（~60% 灰，墨迹 155）。同一公式里的分数线粗细不一，粗者视觉重量
// 达等号 2 倍——用户报告「分数线很粗、与等号出入很大」的直接原因。
//
// border-width 无法修复：子设备像素宽度存在栅格化下限（实测 0.5px 与 0.04em 渲染
// 逐像素相同）；改透明度被否决（压灰不压宽）。唯一正解是网格对齐：把边框中心平移
// 到最近设备像素行中心（位移 <0.5 设备像素，不动宽度/颜色/透明度）。对齐后 0.59
// 设备像素宽的边框恰好覆盖单行 ~59%，与等号字形的 1 行 ~60% 墨迹精确匹配；大字号
// （annoeq 编辑器 ~59px）按比例铺满 2~3 行，保持 TeX 规则线比例。
//
// 对齐经由 MutationObserver 驱动：任何 .katex 子树挂载（三入口 katexHtml /
// engine.annLabelText / engine.annoKatexHtml 及未来调用点）都在同一帧 rAF 内完成，
// 先于绘制、无闪烁。画布缩放（store zoom / 窗口 resize 改 fit）改变视觉相位 →
// 全量重对齐（dy 累积存 data-rsnap-dy，幂等）。getBoundingClientRect 已含祖先
// transform scale（page-wrap 缩放、胶片缩略图）——按视觉像素对齐，各语境通吃。

const RULE_SEL = '.katex .frac-line, .katex .underline-line, .katex .overline-line';

/** 对齐一条规则线：边框中心 → 最近设备像素行中心。幂等（dy 累积）。 */
function alignRule(el: HTMLElement): void {
  const bw = parseFloat(getComputedStyle(el).borderBottomWidth) || 0;
  if (bw <= 0) { el.dataset.rsnapDy = '0'; return; }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return; // 未布局（隐藏容器）：留待可见后再对齐
  const dpr = window.devicePixelRatio || 1;
  const prev = parseFloat(el.dataset.rsnapDy || '0') || 0;
  // 边框占元素盒底部 [bottom-bw, bottom]；rect 已含 prev 平移 → 残余量累加
  const centerDev = (rect.bottom - bw / 2) * dpr;
  const targetDev = Math.round(centerDev - 0.5) + 0.5; // 行 k 的中心是 k+0.5
  const total = prev + (targetDev - centerDev) / dpr;
  el.style.transform = total === 0 ? '' : `translateY(${total.toFixed(4)}px)`;
  el.dataset.rsnapDy = String(total);
}

let pending: Set<HTMLElement> | null = null;
let rafId = 0;

/** 收集待对齐元素，rAF 批处理（同帧合并，先于绘制） */
function scheduleAlign(roots: HTMLElement[]): void {
  if (!pending) pending = new Set();
  for (const r of roots) {
    if (r.matches(RULE_SEL)) pending.add(r);
    for (const el of r.querySelectorAll<HTMLElement>(RULE_SEL)) pending.add(el);
  }
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const els = pending;
    pending = null;
    if (!els) return;
    for (const el of els) if (!el.dataset.rsnapDy) alignRule(el);
  });
}

/** 缩放/视口变化：清旗全量重对齐（相位已变，旧 dy 作废重算）。入口订阅 zoom/resize 调用 */
export function realignKatexRules(): void {
  for (const el of document.querySelectorAll<HTMLElement>(RULE_SEL)) {
    delete el.dataset.rsnapDy;
    el.style.transform = '';
  }
  scheduleAlign([document.documentElement]);
}

let installed = false;

/** 应用入口调用一次（主窗 + 放映窗各自文档）。useStoreSubscribe 接线画布 zoom 变化 */
export function installKatexRuleSnap(useStoreSubscribe: () => void): void {
  if (installed) return;
  installed = true;
  const mo = new MutationObserver((muts) => {
    let roots: HTMLElement[] | null = null;
    for (const m of muts) {
      if (m.type !== 'childList') continue;
      for (const n of m.addedNodes) {
        if (n instanceof HTMLElement && n.querySelector('.katex')) (roots ??= []).push(n);
      }
    }
    if (roots) scheduleAlign(roots);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', realignKatexRules);
  useStoreSubscribe();
  scheduleAlign([document.documentElement]); // 首帧存量对齐（observer 只看增量）
}
