// 注释公式测量/绘制引擎 —— 移植自 Web 版 annotate-equations 复刻（st--/annotate-equations）。
// 渲染管线：公式(KaTeX HTML) → 全文文本索引 → 标记锚定(needle+occ) → 墨迹测量
//   → colorbox 内边距注入（参与排版，相邻框恰好相接不重叠）→ 高亮框绘制
//   → 标注几何（TikZ 规则：标签角点锚定 + 肘形箭头 + stealth 箭头）→ SVG 折线。
// 几何规则与 .sty 逐行对应（详见 fcn 注释）；锚定与字号解耦——任何字号下重新测量。
// 关键差异（vs fcn）：本应用画布可能带 transform: scale（缩放/胶片），
//   getClientRects 为绘制坐标、canvas 度量为布局 px——统一乘 k=holderRect/offsetWidth 校正。

import katex from 'katex';
import { AnnoMark, AnnoState } from '../../model/anno';

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
interface InkBox { left: number; right: number; top: number; bottom: number; baseline: number }

export const mixColor = (hex: string, frac: number): string => {
  const part = (i: number) => Math.round(frac * parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) + (1 - frac) * 255);
  return `rgb(${part(0)},${part(1)},${part(2)})`;
};

const escHtml = (s: string): string => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** 标注文字 → HTML：$..$ 数学片段（KaTeX）、\\\\ 换行、\ 空格、\#%&_ 转义 */
export function annLabelText(text: string): string {
  let out = '', buf = '', i = 0;
  const flush = () => { out += escHtml(buf); buf = ''; };
  while (i < text.length) {
    const c = text[i];
    if (c === '$') {
      const j = text.indexOf('$', i + 1);
      const math = j === -1 ? text.slice(i + 1) : text.slice(i + 1, j);
      flush();
      try {
        out += katex.renderToString(math, { throwOnError: false, strict: false });
      } catch {
        out += '<span style="color:#c0392b">' + escHtml(math) + '</span>';
      }
      i = j === -1 ? text.length : j + 1;
      continue;
    }
    if (c === '\\') {
      const n = text[i + 1];
      if (n === '\\') { buf += '\n'; i += 2; continue; }
      if (n === ' ') { buf += ' '; i += 2; continue; }
      if (n && '#%&_'.includes(n)) { buf += n; i += 2; continue; }
    }
    buf += c; i++;
  }
  flush();
  return out.replace(/\n/g, '<br>');
}

/* ---------------- 文本索引（排除 .katex-mathml 无障碍副本） ---------------- */

interface TextIndexEntry { node: Text; start: number }
export interface TextIndex { text: string; entries: TextIndexEntry[]; map: Map<Text, TextIndexEntry> }

function buildTextIndex(root: HTMLElement): TextIndex {
  const entries: TextIndexEntry[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n: Node) => (n.parentElement && n.parentElement.closest('.katex-mathml'))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.data.length) continue;
    entries.push({ node, start: text.length });
    text += node.data;
  }
  return { text, entries, map: new Map(entries.map((e) => [e.node, e])) };
}

export function locateOcc(text: string, needle: string, occ: number): { start: number; end: number } | null {
  let i = -1;
  for (let k = 0; k <= occ; k++) {
    i = text.indexOf(needle, i + 1);
    if (i === -1) return null;
  }
  return { start: i, end: i + needle.length };
}

export function countOccBefore(text: string, needle: string, before: number): number {
  let n = 0, i = text.indexOf(needle);
  while (i !== -1 && i < before) { n++; i = text.indexOf(needle, i + 1); }
  return n;
}

/* ---------------- 墨迹测量 ---------------- */

let measureCtx: CanvasRenderingContext2D | null = null;

/** 文字片段的墨迹(ink)范围（对应 \colorbox 语义：盒子只含字形墨迹+fboxsep，
 *  不含浏览器行框的 ascent/descent 预留）。
 *  坐标约定：getClientRects/getBoundingClientRect 为【绘制 px】（含祖先 transform 缩放），
 *  canvas 度量与 offsetWidth/绝对定位 left/top 为【布局 px】——统一除以 k 归一到布局 px。 */
function fragmentInkRect(entry: TextIndexEntry, s0: number, s1: number, k: number): InkBox | null {
  const frag = entry.node.data.slice(s0 - entry.start, s1 - entry.start);
  const r = document.createRange();
  r.setStart(entry.node, Math.max(0, s0 - entry.start));
  r.setEnd(entry.node, Math.min(entry.node.data.length, s1 - entry.start));
  const raw = [...r.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
  if (!raw.length) return null;
  const lineRects = raw.map((x) => ({
    left: x.left / k, right: x.right / k, top: x.top / k, bottom: x.bottom / k,
    width: x.width / k, height: x.height / k,
  }));
  const lr = lineRects[0];
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  let box: InkBox | null = null;
  try {
    const cs = getComputedStyle(entry.node.parentElement!);
    measureCtx!.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = measureCtx!.measureText(frag);
    const asc = m.fontBoundingBoxAscent ?? 0;
    const desc = m.fontBoundingBoxDescent ?? 0;
    const aAsc = m.actualBoundingBoxAscent ?? 0;
    const aDesc = m.actualBoundingBoxDescent ?? 0;
    const aLeft = m.actualBoundingBoxLeft ?? 0;
    const aRight = m.actualBoundingBoxRight ?? 0;
    if ([asc, desc, aAsc, aDesc, aLeft, aRight].every(Number.isFinite) && asc + desc > 0) {
      // 行框高度与字体盒高不一致时按比例校正基线
      const scale = lr.height / (asc + desc);
      const baseline = lr.top + asc * scale;
      box = {
        left: lr.left - aLeft,
        right: lr.left + aRight,
        top: baseline - aAsc * scale,
        bottom: baseline + aDesc * scale,
        baseline,
      };
      if (box.right - box.left < 0.5 || box.bottom - box.top < 0.5) box = null; // 墨迹退化
    }
  } catch { /* 度量失败 → 回退行框 */ }
  if (!box) {
    box = {
      left: Math.min(...lineRects.map((x) => x.left)),
      right: Math.max(...lineRects.map((x) => x.right)),
      top: Math.min(...lineRects.map((x) => x.top)),
      bottom: Math.max(...lineRects.map((x) => x.bottom)),
      baseline: lineRects[0].top + lineRects[0].height * 0.8,
    };
  }
  return box;
}

/** 全文片段并集 → holder 相对【布局 px】矩形 */
function rectForSpan(ti: TextIndex, span: { start: number; end: number }, holder: HTMLElement, k: number): Rect | null {
  let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity;
  let any = false;
  for (const e of ti.entries) {
    const s0 = Math.max(e.start, span.start);
    const s1 = Math.min(e.start + e.node.data.length, span.end);
    if (s0 >= s1) continue;
    const b = fragmentInkRect(e, s0, s1, k);
    if (!b) continue;
    any = true;
    L = Math.min(L, b.left); R = Math.max(R, b.right);
    T = Math.min(T, b.top); B = Math.max(B, b.bottom);
  }
  if (!any) return null;
  const hr = holder.getBoundingClientRect();
  return { x: (L - hr.left) / k, y: (T - hr.top) / k, w: (R - L) / k, h: (B - T) / k };
}

/* ---------------- 渲染器 ---------------- */

export interface AnnoSurface {
  eqn: HTMLElement;       // 公式容器（innerHTML = KaTeX HTML；字号由外层 CSS 决定）
  holder: HTMLElement;    // 定位系（position:relative；三层挂其下）
  wrap: HTMLElement;      // 外层 padding 容器（吞掉标注的外扩量）
  marksLayer: HTMLElement;
  annLayer: HTMLElement;
  svg: SVGSVGElement;
}

export interface RendererOpts {
  getLatex: () => string;
  getAnno: () => AnnoState;
  /** 编辑态交互（拖标签/点选）；展示态 false */
  interactive: boolean;
  /** wrap 最小内边距 {v: 垂直, h: 水平, m: 外扩余量}——编辑画布大、幻灯片近似 0 */
  padMin: { v: number; h: number; m: number };
  /** 标注文字 font-family（'' = 继承主题） */
  labelFontCss: string;
  onMarkSelect?: (id: string) => void;
  /** 双击高亮框 → 直接为该标记新建标注（快捷路径） */
  onMarkDoubleClick?: (id: string) => void;
  onAnnSelect?: (id: string) => void;
  /** 拖拽中每帧回调（已换算 ex/em） */
  onAnnDrag?: (id: string, xshift: number, yshift: number) => void;
  onAnnDragEnd?: () => void;
  /** 画布选中态（高亮描边） */
  getSelected?: () => { markId: string | null; annId: string | null };
}

interface AnnPath { color: string; pts: Pt[]; both: boolean }

/** LaTeX 公式 KaTeX HTML（display 模式；错误内联红显，与全局 katexHtml 一致） */
export function annoKatexHtml(latex: string): string {
  return katex.renderToString(latex, { displayMode: true, throwOnError: false, strict: false });
}

export function createAnnoRenderer(surface: AnnoSurface, opts: RendererOpts) {
  const { eqn, holder, wrap, marksLayer, annLayer, svg } = surface;
  let ti: TextIndex | null = null;
  const markRects = new Map<string, Rect>(); // markId -> dispRect
  holder.classList.toggle('ae-live', opts.interactive); // CSS 据此开启层 pointer-events（展示态不拦截页面点击）
  let lastExtents: { top: number; bottom: number; left: number; right: number } | null = null;
  const scaleK = (): number => {
    const hr = holder.getBoundingClientRect();
    return hr.width > 0 && holder.offsetWidth > 0 ? hr.width / holder.offsetWidth : 1;
  };

  /** KaTeX 数学字号（px）——本应用 .katex 压回 1em，即公式容器有效字号 */
  const mathEm = (): number => {
    const el = eqn.querySelector('.katex');
    if (!el) return 0;
    return parseFloat(getComputedStyle(el as HTMLElement).fontSize) || 0;
  };

  /* ---- 标记：锚定 + fboxsep 内边距注入 + colorbox 几何测量 + 高亮框绘制 ---- */
  const injectedEls: HTMLElement[] = []; // 曾注入 padding/color 的元素（重绘前精确清除）
  function drawMarks(): AnnoMark[] {
    marksLayer.innerHTML = '';
    for (const el of injectedEls.splice(0)) {
      el.style.paddingLeft = '';
      el.style.paddingRight = '';
      el.style.color = '';
    }
    const state = opts.getAnno();
    const lost: AnnoMark[] = [];
    markRects.clear();
    if (!ti) { state.marks.forEach((m) => lost.push(m)); return lost; }
    const em = mathEm();
    if (!em) { state.marks.forEach((m) => lost.push(m)); return lost; }
    const k = scaleK();
    const fbox = 0.3 * em * (state.fboxScale ?? 0.5);

    // 锚定：needle+occ → 全文文本索引 → 墨迹范围
    for (const m of state.marks) {
      const span = locateOcc(ti.text, m.needle, m.occ);
      const rect = span ? rectForSpan(ti, span, holder, k) : null;
      if (rect) markRects.set(m.id, rect);
      else lost.push(m);
    }

    // 第一遍：定位每个标记覆盖的叶子元素，注入 fboxsep 内边距（参与排版→相邻框恰好相接）
    const styled: { m: AnnoMark; els: { el: HTMLElement; entry: TextIndexEntry; s0: number; s1: number }[] }[] = [];
    for (const m of state.marks) {
      if (!markRects.has(m.id)) continue;
      const span = locateOcc(ti.text, m.needle, m.occ)!;
      const els: { el: HTMLElement; entry: TextIndexEntry; s0: number; s1: number }[] = [];
      const seen = new Set<HTMLElement>();
      for (const e of ti.entries) {
        const s0 = Math.max(e.start, span.start);
        const s1 = Math.min(e.start + e.node.data.length, span.end);
        if (s0 >= s1) continue;
        const el = e.node.parentElement!;
        if (seen.has(el)) continue;
        seen.add(el);
        els.push({ el, entry: e, s0, s1 });
      }
      if (!els.length) continue;
      if (m.type === 'box' || m.type === 'text') {
        els[0].el.style.paddingLeft = fbox + 'px';
        els[els.length - 1].el.style.paddingRight = fbox + 'px';
      }
      if (m.type === 'text') for (const { el } of els) el.style.color = m.color || '#000';
      for (const { el } of els) injectedEls.push(el);
      styled.push({ m, els });
    }

    void holder.offsetWidth; // 强制回流，使 padding 生效后再测量

    // 第二遍：colorbox 几何 = 元素盒(含 padding)水平范围 ∪ 墨迹(±fbox) ∪ mathstrut（布局 px）
    const hr = holder.getBoundingClientRect();
    for (const { m, els } of styled) {
      let L = Infinity, R = -Infinity, inkT = Infinity, inkB = -Infinity;
      let baseline: number | null = null, baseIsMain = false, bestInk = -1;
      for (const { el, entry, s0, s1 } of els) {
        const b = el.getBoundingClientRect();
        L = Math.min(L, b.left / k); R = Math.max(R, b.right / k);
        const ink = fragmentInkRect(entry, s0, s1, k);
        if (ink) {
          inkT = Math.min(inkT, ink.top); inkB = Math.max(inkB, ink.bottom);
          // 主基线取不在上下标 vlist 内的最大墨迹片段（如 N_b 取 N 的基线）
          const isMain = !el.closest('.vlist');
          const area = (ink.right - ink.left) * (ink.bottom - ink.top);
          if (baseline == null || (isMain && !baseIsMain) || (isMain === baseIsMain && area > bestInk)) {
            baseline = ink.baseline; baseIsMain = isMain; bestInk = area;
          }
        }
      }
      let top = inkT, bottom = inkB;
      if (m.type !== 'plain' && state.equalHeight && baseline != null) {
        // mathstrut：统一 strut 高 + 2×fboxsep，基线对齐（宏包默认）
        top = Math.min(top, baseline - (0.758 * em + fbox));
        bottom = Math.max(bottom, baseline + (0.236 * em + fbox));
      } else {
        top -= fbox; bottom += fbox; // 收缩到内容：墨迹 + fboxsep
      }
      if (m.type === 'plain') { top = inkT; bottom = inkB; } // tikzmarknode：紧贴内容
      markRects.set(m.id, { x: (L - hr.left / k), y: (top - hr.top / k), w: R - L, h: bottom - top });
    }

    // 第三遍：绘制高亮框（单一矩形，对应 \colorbox）
    const sel = opts.getSelected?.();
    for (const { m } of styled) {
      if (m.type !== 'box') continue;
      const r = markRects.get(m.id)!;
      const div = document.createElement('div');
      div.className = 'ae-mark-box';
      div.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;` +
        `background:${mixColor(m.color || '#000000', state.shade / 100)};`;
      div.title = m.name;
      if (opts.interactive) {
        if (sel?.markId === m.id) div.classList.add('sel');
        div.addEventListener('mousedown', (e) => { e.stopPropagation(); opts.onMarkSelect?.(m.id); });
        div.addEventListener('dblclick', (e) => { e.stopPropagation(); opts.onMarkDoubleClick?.(m.id); });
      }
      marksLayer.appendChild(div);
    }
    return lost;
  }

  /* ---- 标注几何（TikZ 规则）---- */
  function markAnchor(m: AnnoMark, side: 'N' | 'S'): Pt {
    const r = markRects.get(m.id)!;
    const cx = r.x + r.w / 2;
    return side === 'N' ? { x: cx, y: r.y } : { x: cx, y: r.y + r.h };
  }
  function drawAnnotations(): void {
    annLayer.innerHTML = '';
    svg.innerHTML = '';
    const state = opts.getAnno();
    const em = mathEm();
    if (!em) { lastExtents = null; return; }
    const L = em * state.annFontScale;
    const ex = L * 0.46;
    const holderW = holder.offsetWidth || 1, holderH = holder.offsetHeight || 1;
    svg.setAttribute('width', String(holderW));
    svg.setAttribute('height', String(holderH));
    svg.setAttribute('viewBox', `0 0 ${holderW} ${holderH}`);

    const extents = { top: 0, bottom: holderH, left: 0, right: holderW };
    const paths: AnnPath[] = [];
    const sel = opts.getSelected?.();

    const reasons = new Map<string, string>();
    for (const a of state.annotations) {
      const marks = a.markIds.map((id) => state.marks.find((m) => m.id === id)).filter((m): m is AnnoMark => m != null && markRects.has(m.id));
      if (!marks.length) { reasons.set(a.id, '未关联有效标注点'); continue; }
      if (a.type === 'two' && marks.length < 2) { reasons.set(a.id, '连接式标注需要恰好选择 2 个标注点'); continue; }

      const color = a.colorAuto ? (marks[0].color || '#000000') : a.color;
      const labelColor = mixColor(color, 0.85);

      const label = document.createElement('div');
      label.className = 'ae-ann-label';
      // 字号写 em（相对 wrap 正文 em）：页面 fit 压缩时标签与公式同步缩放，
      // 排版扫描器同步探测无反馈滞后（px 会与探测状态错拍→振荡）
      const wrapEm = parseFloat(getComputedStyle(wrap).fontSize) || 16;
      label.style.fontSize = L / wrapEm + 'em';
      label.style.color = labelColor;
      if (opts.labelFontCss) label.style.fontFamily = opts.labelFontCss;
      label.innerHTML = annLabelText(a.text);
      label.dataset.annId = a.id;
      if (sel?.annId === a.id) label.classList.add('sel');
      annLayer.appendChild(label);
      const w = label.offsetWidth, h = label.offsetHeight;

      const above = a.pos.startsWith('above');
      const left = a.pos.endsWith('left');
      const dx = a.xshift * ex, dy = -a.yshift * L; // TikZ y 轴向上

      let leftX: number, topY: number, lineY: number, P: Pt;

      if (a.type === 'two') {
        const side = above ? 'N' : 'S';
        const A1 = markAnchor(marks[0], side), A2 = markAnchor(marks[1], side);
        const M = { x: (A1.x + A2.x) / 2, y: (A1.y + A2.y) / 2 };
        leftX = M.x - w / 2;
        topY = above ? M.y - h : M.y;
        leftX += dx; topY += dy;
        lineY = a.labelBelow ? topY - 0.1 * ex : topY + h - 0.1 * ex;
        P = { x: leftX + w / 2, y: lineY };
        paths.push({ color, pts: [A1, { x: A1.x, y: lineY }, P, { x: A2.x, y: lineY }, A2], both: true });
      } else {
        const side = above ? 'N' : 'S';
        const A = markAnchor(marks[0], side);
        // 标签角点锚定：above+right→SW, above+left→SE, below+right→NW, below+left→NE
        if (above) { topY = A.y - h; leftX = left ? A.x - w : A.x; }
        else { topY = A.y; leftX = left ? A.x - w : A.x; }
        leftX += dx; topY += dy;
        lineY = topY + h - 0.1 * ex;    // \annotate 的线恒在标签底边
        const lineX = left ? leftX + 0.3 * ex : leftX + w - 0.3 * ex;
        P = { x: lineX, y: lineY };
        for (const m of marks) {
          const Ai = markAnchor(m, side);
          paths.push({ color, pts: [Ai, { x: Ai.x, y: lineY }, P], both: false });
        }
      }

      label.style.left = leftX + 'px';
      label.style.top = topY + 'px';
      extents.top = Math.min(extents.top, topY);
      extents.bottom = Math.max(extents.bottom, topY + h);
      extents.left = Math.min(extents.left, leftX);
      extents.right = Math.max(extents.right, leftX + w);
      for (const p of paths) for (const pt of p.pts) {
        extents.top = Math.min(extents.top, pt.y);
        extents.bottom = Math.max(extents.bottom, pt.y);
        extents.left = Math.min(extents.left, pt.x);
        extents.right = Math.max(extents.right, pt.x);
      }

      if (opts.interactive) {
        label.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          opts.onAnnSelect?.(a.id);
          const k = scaleK(); // 鼠标位移为屏幕 px；ex/L 为布局 px——按 k 折算
          const x0 = e.clientX, y0 = e.clientY;
          const sx = a.xshift, sy = a.yshift;
          const move = (ev: MouseEvent) => {
            const ns = +(sx + (ev.clientX - x0) / k / ex).toFixed(2);
            const ny = +(sy - (ev.clientY - y0) / k / L).toFixed(2);
            a.xshift = ns; a.yshift = ny; // 就地写回（getAnno 引用同一对象）
            drawAnnotations();
            opts.onAnnDrag?.(a.id, ns, ny);
          };
          const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            opts.onAnnDragEnd?.();
          };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        });
      }
    }

    // 箭头线 + 显式多边形箭头（TikZ stealth；不用 SVG marker 的 orient——跨浏览器一致）。
    // 线宽 ∝ KaTeX 字号（≈4.1%）；下限 0.55px 仅防退化——原 1.3px 下限按 fcn 30px 画布
    // 标定，在幻灯片 ~18px 布局字号下相对粗近一倍、箭头随之臃肿（第卅一轮修复）
    const sw = Math.max(0.55, em * 0.0413);
    const headLen = 7.5 * sw, headW = 2.8 * sw, notch = 2.2 * sw;
    const head = (E: Pt, d: Pt, color: string): string => {
      const px = -d.y, py = d.x;
      const bx = E.x - d.x * headLen, by = E.y - d.y * headLen;
      const pts = [
        [E.x, E.y],
        [bx + px * headW, by + py * headW],
        [E.x - d.x * notch, E.y - d.y * notch],
        [bx - px * headW, by - py * headW],
      ].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
      return `<polygon points="${pts}" fill="${color}"/>`;
    };
    const dirAt = (pts: Pt[], fromEnd: boolean): Pt => {
      const E = fromEnd ? pts[pts.length - 1] : pts[0];
      for (let i = 1; i < pts.length; i++) {
        const Q = fromEnd ? pts[pts.length - 1 - i] : pts[i];
        const dx = E.x - Q.x, dy = E.y - Q.y, len = Math.hypot(dx, dy);
        if (len > 0.01) return { x: dx / len, y: dy / len };
      }
      return { x: 0, y: fromEnd ? -1 : 1 };
    };
    let body = '';
    for (const p of paths) {
      const pts = p.pts.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
      body += `<polyline points="${pts}" fill="none" stroke="${p.color}" stroke-width="${sw}" stroke-linejoin="miter"/>`;
      body += head(p.pts[0], dirAt(p.pts, false), p.color);
      if (p.both) body += head(p.pts[p.pts.length - 1], dirAt(p.pts, true), p.color);
    }
    svg.innerHTML = body;
    lastExtents = extents;
    // 失效原因（编辑面板显示；容器 data 属性避免重绘 DOM）
    annLayer.dataset.invalid = reasons.size ? String(reasons.size) : '';
  }
  /** padding 写 em（相对 wrap 正文 em）：几何按 em 尺度不变（fc n 全 em 派生），
   *  页面 fit 压缩时块高随字号同步缩放——排版扫描器的同步探测不会与上一状态的
   *  px 测量错拍（曾致 fit=1↔0.95 振荡）。padMin 以 px 计为下限。 */
  function updateWrapPadding(): void {
    const { v, h, m } = opts.padMin;
    const wf = parseFloat(getComputedStyle(wrap).fontSize) || 16;
    const em = (px: number) => px / wf + 'em';
    if (!lastExtents) { wrap.style.padding = `max(${em(v)}, 1px) max(${em(h)}, 2px)`; return; }
    const e = lastExtents;
    const padT = Math.max(v, -e.top + m);
    const padB = Math.max(v, e.bottom - holder.offsetHeight + m);
    const padL = Math.max(h, -e.left + m);
    const padR = Math.max(h, e.right - holder.offsetWidth + m);
    wrap.style.padding = `${em(padT)} ${em(padR)} ${em(padB)} ${em(padL)}`;
  }

  /* ---- 选区捕获（编辑态：选中公式文字 → 标注点） ---- */
  function globalIndexAt(container: Node, offset: number, isStart: boolean): number | null {
    if (!ti) return null;
    if (container.nodeType === Node.TEXT_NODE) {
      const e = ti.map.get(container as Text);
      return e ? e.start + offset : null;
    }
    if (!eqn.contains(container)) return null;
    const kids = container.childNodes;
    if (offset >= kids.length) return ti.text.length;
    const ref = kids[offset];
    if (isStart) {
      for (const e of ti.entries) {
        if (ref.contains(e.node) || ref.compareDocumentPosition(e.node) & Node.DOCUMENT_POSITION_FOLLOWING) return e.start;
      }
      return 0;
    }
    let last = 0;
    for (const e of ti.entries) {
      if (ref.compareDocumentPosition(e.node) & Node.DOCUMENT_POSITION_PRECEDING) {
        last = Math.max(last, e.start + e.node.data.length);
      } else break;
    }
    return last;
  }

  /** 当前选区 → 标注点原料（needle/occ + 屏幕矩形）；无效选区 null。
   *  vpRect 供 fixed 定位浮动条用——绘制 px（rect 布局 px × k）。 */
  function captureSelection(sel: Selection): { needle: string; occ: number; vpRect: { left: number; top: number; w: number; h: number } } | null {
    if (!ti || sel.rangeCount === 0 || sel.isCollapsed) return null;
    if (!eqn.contains(sel.anchorNode) || !eqn.contains(sel.focusNode)) return null;
    const range = sel.getRangeAt(0);
    let s = globalIndexAt(range.startContainer, range.startOffset, true);
    let d = globalIndexAt(range.endContainer, range.endOffset, false);
    if (s === null) s = 0;
    if (d === null) d = ti.text.length;
    if (d <= s || d - s > 400) return null;
    const needle = ti.text.slice(s, d);
    if (!needle.trim()) return null;
    const occ = countOccBefore(ti.text, needle, s);
    const k = scaleK();
    const rect = rectForSpan(ti, { start: s, end: d }, holder, k);
    if (!rect) return null;
    const hr = holder.getBoundingClientRect();
    return { needle, occ, vpRect: { left: hr.left + rect.x * k, top: hr.top + rect.y * k, w: rect.w * k, h: rect.h * k } };
  }

  /* ---- 对外 ---- */

  /** 全量：公式重渲染 → 索引 → 标记 → 标注 → padding。返回失锚标记 */
  function renderAll(): AnnoMark[] {
    const latex = opts.getLatex();
    if (!latex.trim()) {
      eqn.innerHTML = '';
      annLayer.innerHTML = '';
      marksLayer.innerHTML = '';
      svg.innerHTML = '';
      annLayer.dataset.invalid = '';
      ti = null;
      markRects.clear();
      lastExtents = null;
      updateWrapPadding();
      return [];
    }
    eqn.innerHTML = annoKatexHtml(latex);
    ti = buildTextIndex(eqn);
    const lost = drawMarks();
    drawAnnotations();
    updateWrapPadding();
    return lost;
  }

  /** 公式 DOM 不变，标记/标注/样式微调（锚定在 drawMarks 内重做） */
  function refreshCanvas(): void {
    drawMarks();
    drawAnnotations();
    updateWrapPadding();
  }

  /** 悬停卡片 → 虚线亮出锚点位置 */
  function previewMark(m: AnnoMark | null): void {
    marksLayer.querySelector('.ae-mark-box.plain-preview')?.remove();
    if (!m) return;
    const r = markRects.get(m.id);
    if (!r) return;
    const d = document.createElement('div');
    d.className = 'ae-mark-box plain-preview';
    d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;` +
      `border-color:${m.color || '#888'};`;
    marksLayer.appendChild(d);
  }

  return { renderAll, refreshCanvas, drawAnnotations, previewMark, captureSelection, mathEm };
}

export type AnnoRenderer = ReturnType<typeof createAnnoRenderer>;
