// KaTeX 规则线（分数线/上下划线）渲染修正：背景带 + scale 补偿 + 设备网格对齐
//
// 根因（第卌三轮，真实 exe + 用户工程实测钉死）：
//   画布 page-wrap 有 transform: scale(~1.91)（适窗缩放）。KaTeX 规则线是 0.04em
//   CSS 边框——局部坐标 ~0.36px 被 Chromium 布局阶段吸附到 1 设备像素（0.8px，
//   used-width 硬下限，实测 0.5px 与 0.04em 渲染逐像素相同），再被 scale 放大成
//   ~1.53 视觉 px ≈ 2 设备行的实心黑带（实测墨迹 437 = 等号杠的 3.4 倍）。
//   而等号/加减的字形笔画经字体 hinting 在局部坐标就收敛到 ~1 行，transform
//   合成时按最终分辨率重光栅化，恒定渲染为 1 行深灰（墨迹 ~128/杠）。
//   → border 路线无解：任何 <0.8px 的宽度都被布局吸附回 0.8px，再乘 scale 放大。
//
// 修复：规则线改由背景带绘制（背景是绘制命令，合成阶段按最终分辨率执行，
// 不经布局吸附，任意小数尺寸精确生效）：
//   视觉高度 = max(1/dpr, 0.04em 设计值×字号×scale)
//     小字号 → 恰好 1 设备行，与 hinting 后的字形笔画同重；
//     大字号（annoeq 编辑器）→ 保持 TeX 规则线/字重的经典比例。
//   border 保留占位但置透明（布局/间距完全不变）；background-origin: border-box
//   使带贴盒底；translateY 把带中心对齐最近设备像素行中心（<0.5px，防骑界双行）。
//   颜色走 currentColor——\textcolor 着色的 annotate 分数线/下划线自动跟随。
//
// 驱动：MutationObserver 观察任何 .katex 子树挂载（三入口 katexHtml /
// engine.annLabelText / engine.annoKatexHtml 与未来调用点全覆盖），rAF 批处理、
// 先于绘制零闪烁。scale 变化（画布 zoom / resize 改 fit）→ 全量重算（带宽随
// scale 变化，必须重写 background-size；幂等：rsnapDy 只用于 transform 累积）。
// 打印/PDF：print 管线 page-wrap transform:none → scale=1 自动重算，矢量输出
// 精确矩形。累计 scale 取 rect.width/offsetWidth——含 page-wrap 与胶片缩略图
// 任意祖先 transform，各语境通吃。

const RULE_SEL = '.katex .frac-line, .katex .underline-line, .katex .overline-line';

function restyleRule(el: HTMLElement): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return; // 未布局（隐藏容器）：留待可见后再处理
  const scale = rect.width / el.offsetWidth || 1;
  // 设计宽度规格：KaTeX inline style 'border-bottom-width:0.04em'（吸附前）
  const bwEm = parseFloat(el.style.borderBottomWidth) || 0.04;
  const fs = parseFloat(getComputedStyle(el).fontSize) || 12;
  const hVisual = Math.max(1 / dpr, bwEm * fs * scale);
  const hLocal = hVisual / scale;
  el.style.borderBottomColor = 'transparent';
  el.style.backgroundImage = 'linear-gradient(currentColor, currentColor)';
  el.style.backgroundSize = `100% ${hLocal.toFixed(4)}px`;
  el.style.backgroundPosition = '0 100%';
  el.style.backgroundOrigin = 'border-box';
  el.style.backgroundRepeat = 'no-repeat';
  // 带中心（视觉坐标）→ 最近设备像素行中心；dy 累积存 data-rsnap-dy（幂等重算）
  const prev = parseFloat(el.dataset.rsnapDy || '0') || 0;
  const centerDev = (rect.bottom - hVisual / 2) * dpr;
  const targetDev = Math.round(centerDev - 0.5) + 0.5;
  const total = prev + (targetDev - centerDev) / dpr;
  el.style.transform = total ? `translateY(${total.toFixed(4)}px)` : '';
  el.dataset.rsnapDy = String(total);
}

let pending: Set<HTMLElement> | null = null;
let rafId = 0;

/** 收集待处理规则线，rAF 批处理（同帧合并，先于绘制） */
function scheduleRestyle(roots: HTMLElement[]): void {
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
    for (const el of els) if (!el.dataset.rsnapDy) restyleRule(el);
  });
}

/** 打印/PDF 专用：#print-root 内规则线按纯设计值重算（矢量输出无栅格化，
 *  1 设备行下限反而会让规则线比字形笔画粗 ~2×；0.04em 设计值即正确比例）。
 *  print-root 无 page-wrap transform → scale 恒 1。exportPdf 在 printPDF 前调用。 */
export function restyleRulesForPrint(): void {
  const root = document.getElementById('print-root');
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>(RULE_SEL)) {
    const bwEm = parseFloat(el.style.borderBottomWidth) || 0.04;
    const fs = parseFloat(getComputedStyle(el).fontSize) || 12;
    el.style.borderBottomColor = 'transparent';
    el.style.backgroundImage = 'linear-gradient(currentColor, currentColor)';
    el.style.backgroundSize = `100% ${(bwEm * fs).toFixed(4)}px`;
    el.style.backgroundPosition = '0 100%';
    el.style.backgroundOrigin = 'border-box';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.transform = '';
    delete el.dataset.rsnapDy;
  }
}

/** scale 已变（画布 zoom / 窗口 resize）：清旗全量重算（带宽 + 对齐都要更新） */
export function realignKatexRules(): void {
  for (const el of document.querySelectorAll<HTMLElement>(RULE_SEL)) {
    delete el.dataset.rsnapDy;
    el.style.transform = '';
  }
  scheduleRestyle([document.documentElement]);
}

let installed = false;

/** 应用入口调用一次（主窗 + 放映窗各自文档）。subscribeZoom 接线画布缩放变化 */
export function installKatexRuleSnap(subscribeZoom: () => void): void {
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
    if (roots) scheduleRestyle(roots);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', realignKatexRules);
  subscribeZoom();
  scheduleRestyle([document.documentElement]); // 首帧存量处理（observer 只看增量）
}
