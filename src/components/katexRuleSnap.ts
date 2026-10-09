import { unifyKatexBrace } from './katexBrace';

// KaTeX 规则线（分数线/上下划线/根号顶线）渲染修正
//
// 三个问题、一套机制（设备像素下限 + 背景带/SVG 带重写 + 全量增量双入口）：
//
// 1. border 路线无解（第卌三轮实测钉死）：画布 page-wrap 有 transform: scale(~1.91)，
//    KaTeX 规则线是 0.04em CSS 边框——局部坐标 ~0.36px 被布局阶段吸附到 1 设备像素
//    （0.8px used-width 硬下限），再被 scale 放大成实心黑带。修复：改由背景带绘制
//    （背景是绘制命令，合成阶段按最终分辨率执行，不经布局吸附），
//    border 保留占位置透明（布局/间距完全不变），translateY 对齐设备像素行中心。
//
// 2. 分数 DPR 屏上亚像素带整数量化消失（第卌一轮物理墨迹实测）：分数 DPR（Windows
//    125% 缩放）上合成器可能以 ≈dpr 的分辨率栅格化被 transform 放大的图层，
//    hLocal×raster < 0.5 纹素 → 舍入到 0 行 → 彻底消失。给 local 带高加
//    0.55/dpr 下限，保证最坏栅格化下至少落 1 纹素行。
//
// 3. 根号顶线（vinculum）是 SVG path 子路径（40/1000em 矩形带）：不受布局吸附影响，
//    但小字号/低 scale 下亚像素带在纹理空间 AA 后墨迹过淡甚至消失。修复：重写 path
//    的 vinculum 子路径高度（v40 → v{40×k}），套用与分数线相同的设备像素下限；
//    顶边 y 固定只向下加厚（视觉上与分数线加厚方向一致）。
//
// 覆盖缺口修复（本轮）：MutationObserver 只查 addedNode 的后代（querySelector），
//    innerHTML 注入的 .katex 节点自身永远不命中——晚到的公式（LaTeX 实时预览、
//    annoeq 重渲染、标注文字）全部逃过 restyle，保持 border 路线在分数 DPR 屏上
//    随机消失。现在 n.matches('.katex') 自匹配 + 后代匹配双通道。
//
// 驱动：MutationObserver 观察任何 .katex 相关节点挂载（三入口 katexHtml /
// engine.annLabelText / engine.annoKatexHtml 与未来调用点全覆盖），rAF 批处理、
// 先于绘制零闪烁。批内量测/写入两遍分离（read→write→read 交错会逐元素强制
// reflow）；scale 变化（画布 zoom / resize 改 fit / 放映缩放）→ rAF 合并的全量重算
// （缩放风暴每帧最多一次全文档扫描）。打印/PDF：print 管线 transform:none →
// scale=1 且矢量输出无栅格化，按纯设计值重算（0.04em 与字形笔画的 TeX 经典比例；
// 1 设备行下限反而会让线粗 ~2×）。
//
// 累计 scale 取 rect.height/布局高——含 page-wrap、胶片缩略、放映缩放任意祖先
// transform，各语境通吃。

/** 根号顶线子路径签名：M{x} {hLinePad=80}h/H400000 v{n} h-400000z（sqrtMain/size1-4，
 *  小写 h 闭合）或 H{短距}z（sqrtTall——内容 ≳3.5em 的高根号，大写 H + 短回程闭合）。
 *  400000 全宽 + h400000 夹 v 高度是 vinculum 独有形状，stretchy 箭头/括号延伸条、
 *  over/underbrace、widehat 等均无此签名（17 类构造实测零误报）；仅 .hide-tail 下
 *  的 sqrt svg 命中。导出供 exportPdf 的 E2E 快照复用，防止两份字面量漂移。 */
export const VINCULUM_RE = /(M\d+ 80\s*[hH]400000v)(\d+)(h-400000z|H\d+z)/g;

const RULE_SEL = '.katex .frac-line, .katex .underline-line, .katex .overline-line';

/** 设备像素下限（分数线与根号线共用）：保证带在【最坏栅格化】下至少 ~0.55 纹素
 *  （AA 可见阈值 ~0.5 纹素；实测 0.36 纹素消失 / 0.38 可见）。
 *
 *  最坏情形 = 合成器按 dpr（不含祖先 transform scale）栅格化被缩放图层——
 *  「dpr=1 恒按最终分辨率 AA」只在部分机器/屏成立（第卌一轮实测口径）；
 *  用户双屏实测（放映窗落 100% 缩放副屏，累计 scale 4.27×）证明 dpr=1 的
 *  合成器也会走 dpr 栅格化：0.29px 局部带 → 0.29 纹素 → 整条线量化归零
 *  （(1.1) 式分式线消失实锤，0.47px 线恰在阈值附近时隐时现）。
 *  故 0.55/dpr 下限【无条件】生效（原先仅 dpr>1），任何栅格化策略下线恒可见。
 *  大字号/高缩放下设计值本就超下限，视觉不受影响；小字号局部带上浮到
 *  0.55/dpr（视觉 0.55×scale/dpr）——与同字号字形笔画重量同量级，不会过粗。 */
function flooredHeights(designLocal: number, scale: number): { hLocal: number; hVisual: number } {
  const dpr = window.devicePixelRatio || 1;
  // 三重下限：① TeX 设计值 ② 纹素可见（dpr 栅格化）③ 视觉 1 设备行（最终分辨率
  // 栅格化 + 缩略图/缩小场景）。①②③ 任一栅格化策略下线恒可见。
  const hLocal = Math.max(designLocal, 0.55 / dpr, 1 / (dpr * scale));
  const hVisual = hLocal * scale;
  return { hLocal, hVisual };
}

/* ---------------- 量测/写入两遍分离（read→write 交错 = 每元素一次强制 reflow） ---------------- */

interface RuleJob {
  el: HTMLElement;
  rect: DOMRect;
  scale: number;
  bwEm: number;
  fs: number;
}

interface SqrtJob {
  path: SVGPathElement;
  orig: string;
  vUnits: number;
  designLocal: number;
  scale: number;
}

function measureRule(el: HTMLElement): RuleJob | null {

  // print-root 只走 restyleRulesForPrint 的矢量口径；屏幕 restyle/重排跳过
  // （导出 await 期间 resize 触发 realign 会把设计值改回屏幕下限 → PDF 线过粗）
  if (el.closest('#print-root')) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return null; // 未布局（隐藏容器）：留待可见后再处理
  return {
    el,
    rect,
    scale: rect.width / el.offsetWidth || 1,
    // 设计宽度规格：KaTeX inline style 'border-bottom-width:0.04em'（吸附前）
    bwEm: parseFloat(el.style.borderBottomWidth) || 0.04,
    fs: parseFloat(getComputedStyle(el).fontSize) || 12,
  };
}

function applyRule(j: RuleJob): void {

  const { el, rect } = j;
  const { hLocal, hVisual } = flooredHeights(j.bwEm * j.fs, j.scale);
  el.style.borderBottomColor = 'transparent';
  el.style.backgroundImage = 'linear-gradient(currentColor, currentColor)';
  el.style.backgroundSize = `100% ${hLocal.toFixed(4)}px`;
  el.style.backgroundPosition = '0 100%';
  el.style.backgroundOrigin = 'border-box';
  el.style.backgroundRepeat = 'no-repeat';
  // 带中心（视觉坐标）→ 最近设备像素行中心；dy 累积存 data-rsnap-dy（幂等重算）
  const dpr = window.devicePixelRatio || 1;
  const prev = parseFloat(el.dataset.rsnapDy || '0') || 0;
  const centerDev = (rect.bottom - hVisual / 2) * dpr;
  const targetDev = Math.round(centerDev - 0.5) + 0.5;
  const total = prev + (targetDev - centerDev) / (dpr * j.scale);
  el.style.transform = total ? `translateY(${total.toFixed(4)}px)` : '';
  el.dataset.rsnapDy = String(total);
}

function measureSqrt(path: SVGPathElement): SqrtJob | null {
  // print-root 只走 restyleRulesForPrint 的矢量口径（同 measureRoot 守卫）
  if (path.closest('#print-root')) return null;
  const orig = path.dataset.rsnapVd ?? path.getAttribute('d') ?? '';
  if (!orig) return null;
  VINCULUM_RE.lastIndex = 0; // 模块级 g 正则：exec 前复位，防上次匹配位置污染
  const vMatch = VINCULUM_RE.exec(orig);
  if (!vMatch) { path.dataset.rsnapVd = ''; return null; }
  path.dataset.rsnapVd = orig;
  const svg = path.ownerSVGElement;
  if (!svg) return null;
  const vbH = parseFloat((svg.getAttribute('viewBox') || '').trim().split(/\s+/)[3] || '');
  if (!(vbH > 0)) return null;
  const rect = svg.getBoundingClientRect();
  const layoutH = parseFloat(getComputedStyle(svg).height) || 0;
  if (rect.height <= 0 || layoutH <= 0) return null; // 未布局：留待可见后再处理
  const vUnits = parseFloat(vMatch[2]);
  return { path, orig, vUnits, designLocal: (vUnits / vbH) * layoutH, scale: rect.height / layoutH || 1 };
}

function applySqrt(j: SqrtJob): void {
  const { path, orig, vUnits } = j;
  const { hVisual } = flooredHeights(j.designLocal, j.scale);
  const k = hVisual / (j.designLocal * j.scale);
  if (Math.abs(k - 1) < 0.02) {
    if (path.getAttribute('d') !== orig) path.setAttribute('d', orig);
    return;
  }
  path.setAttribute('d', orig.replace(VINCULUM_RE, (_m, pre: string, v: string, post: string) =>
    pre + Math.max(vUnits, Math.round(vUnits * k)) + post));
}


let pendingRules: Set<HTMLElement> | null = null;
let pendingSqrt: Set<SVGPathElement> | null = null;
let batchToken = 0;

/** 收集待处理规则线/根号线/堆叠定界符，rAF 批处理（同帧合并，先于绘制；
 *  批内先量测全部再写入全部，消除逐元素强制 reflow） */
function scheduleRestyle(roots: Element[]): void {
  if (!pendingRules) pendingRules = new Set();
  if (!pendingSqrt) pendingSqrt = new Set();
  for (const r of roots) {
    if (r instanceof HTMLElement) {
      if (r.matches(RULE_SEL)) pendingRules.add(r);
      for (const el of r.querySelectorAll<HTMLElement>(RULE_SEL)) pendingRules.add(el);
      for (const mult of r.querySelectorAll<HTMLElement>('.delimsizing.mult')) unifyKatexBrace(mult);
      if (r.matches('.delimsizing.mult')) unifyKatexBrace(r);
    }
    // 自匹配：observer 也可能推送单个插入的 path 节点（后代查询查不到自身）
    if (r instanceof SVGPathElement) {
      if (r.dataset.rsnapVd !== '') pendingSqrt.add(r);
      continue;
    }
    const scope = r instanceof HTMLElement && r.matches('.hide-tail') ? r : null;
    const paths = scope ? scope.querySelectorAll('path') : r.querySelectorAll('.hide-tail path');
    for (const p of paths) {
      const el = p as SVGPathElement;
      if (el.dataset.rsnapVd !== '') pendingSqrt.add(el); // '' = 已判定非 vinculum
    }
  }
  if (batchToken) return;
  const token = ++batchToken;
  const run = () => {
    if (batchToken !== token) return; // 双通道只放行一次
    batchToken = 0;
    const rules = pendingRules;
    const sqrts = pendingSqrt;
    pendingRules = null;
    pendingSqrt = null;
    if (!rules && !sqrts) return;
    const ruleJobs: RuleJob[] = [];
    if (rules) for (const el of rules) if (!el.dataset.rsnapDy) {
      const j = measureRule(el);
      if (j) ruleJobs.push(j);
    }
    const sqrtJobs: SqrtJob[] = [];
    if (sqrts) for (const p of sqrts) {
      const j = measureSqrt(p);
      if (j) sqrtJobs.push(j);
    }
    for (const j of ruleJobs) applyRule(j);
    for (const j of sqrtJobs) applySqrt(j);
  };
  // rAF 先到先跑（同帧合批、先于绘制）；setTimeout 兜底：遮挡/最小化窗口下
  // Chromium 暂停 rAF（实测整轮饿死——「偶发消失」的根因之一），定时器不受影响
  requestAnimationFrame(run);
  setTimeout(run, 50);
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
  for (const p of root.querySelectorAll<SVGPathElement>('.hide-tail path')) {
    if (p.dataset.rsnapVd && p.dataset.rsnapVd !== '') p.setAttribute('d', p.dataset.rsnapVd);
  }
}

let realignToken = 0;

/** scale 已变（画布 zoom / 窗口 resize / 放映缩放）：清旗全量重算（带宽 + 对齐都要更新）。
 *  rAF 合并（缩放风暴每帧最多一次全文档扫描）+ setTimeout 兜底（遮挡窗 rAF 暂停）。 */
export function realignKatexRules(): void {
  if (realignToken) return;
  const token = ++realignToken;
  const run = () => {
    if (realignToken !== token) return;
    realignToken = 0;
    for (const el of document.querySelectorAll<HTMLElement>(RULE_SEL)) {
      delete el.dataset.rsnapDy;
      el.style.transform = '';
    }
    scheduleRestyle([document.documentElement]);
  };
  requestAnimationFrame(run);
  setTimeout(run, 50);
}

let installed = false;

/** 应用入口调用一次（主窗 + 放映窗各自文档）。subscribeZoom 接线画布缩放变化 */
export function installKatexRuleSnap(subscribeZoom: () => void): void {
  if (installed) return;
  installed = true;
  const mo = new MutationObserver((muts) => {
    let roots: Element[] | null = null;
    for (const m of muts) {
      if (m.type !== 'childList') continue;
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        // 自匹配 + 后代匹配双通道：innerHTML 注入的 .katex 自身（及 KaTeX 内部
        // 增量插入的 path/规则线节点）都必须命中——旧实现只查后代，晚到的公式
        // 全部逃过 restyle（分数 DPR 屏上随机消失的直接根因）
        if (n instanceof HTMLElement && (n.matches('.katex') || n.querySelector('.katex'))) {
          (roots ??= []).push(n);
        } else if (n.closest('.katex')) {
          (roots ??= []).push(n);
        }
      }
    }
    if (roots) scheduleRestyle(roots);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', realignKatexRules);
  // Windows monitor changes can alter DPR without changing the CSS viewport size.
  const watchResolution = () => {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', () => {
      realignKatexRules();
      watchResolution();
    }, { once: true });
  };
  watchResolution();
  subscribeZoom();
  scheduleRestyle([document.documentElement]); // 首帧存量处理（observer 只看增量）
}
