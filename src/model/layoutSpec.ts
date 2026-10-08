// 排版规格引擎 v2（纯函数，可单测）——固定字阶 + 密度阶梯（间距/字号）+ 图高天花板：
//   固定字阶：全局标准 fontSize（PPT 等效 pt，默认 16）推导正文/页眉标题/页脚，
//     全 deck 每页一致（规矩；字号永不随页面内容量变化，页面间不割裂）；
//     每页仅可用 fontScale（0.6–1.5）调「正文区」，页眉/页脚永不参与。
//   密度调节只走间距与字号：间距阶梯 s∈[0,1]（行高 1.5→1.2、统一段距 1.2→0.6em、
//     项距 0.7→0.4em——所有块共用「段前 0 + 段后统一值」单一约定，无类型不对称），
//     由 useLayoutScan 静默探测按需压实；
//   图像尺寸：宽度（块 width，栏宽比例）权威；限高唯一起点即天花板 IMG_H_MAX——
//     放得下多少由扫描器实测，不做文本量估算预压（第廿九轮：估错即冤案、棘轮单向回不来）；
//   溢出兜底字号下限恒为 标准×60%（fitMin = FIT_MIN/fontScale，≤1）——哪怕溢出也不再小。
//   四原则落点：对齐（5cqw 边距/4cqw 栏距）、对比（固定比例字阶）、
//   亲密（题注 0.5em < 项距 < 块距 < 段距）、重复（同 deck 同字阶 + 纯函数确定性）。

import { Block } from './types';

/** PPT 等效 pt → 本页物理 pt：标准幻灯片 10in(254mm) 宽 → 本页 16:9 为 160mm 宽 */
export const PPT2PHYS = 160 / 254;

/** 字号兜底下限 = 标准 × 60%（全局不变量） */
export const FIT_MIN = 0.6;
/** 每页 fontScale 允许范围 */
export const PAGE_FONT_MIN = 0.6;
export const PAGE_FONT_MAX = 1.5;
/** 图限高边界（cqh）：起点恒为 MAX（天花板）；MIN 为扫描器压实下限。
 *  纯图页（无文本/公式/表格内容块）MAX 提升到 78：整页只放图时正文区高约 82cqh，
 *  55 天花板会把 aspect≈1.5 的图钳到半宽（width=1 实绘仅 54%——用户实测报障）；
 *  扫描器仍从 MAX 实测压回放得下的最大值，不会溢出。混合页维持 55 不变 */
 export const IMG_H_MIN = 16;
export const IMG_H_MAX = 55;
export const IMG_H_MAX_IMGONLY = 78;

/** 页级排版状态（扫描器产出，存 store.pageLayout，内存态不写 md） */
export interface SpacingState {
  /** 间距压实度 0=宽松 → 1=紧凑 */
  s: number;
  /** 图/视频限高（cqh） */
  imgH: number;
  /** 字号兜底系数（1=正常；下限 spec.fitMin） */
  fit: number;
}

/** Finalized static layout; navigation and focus reuse a matching signature. */
export interface PageLayout extends SpacingState {
  signature?: string;
}

export interface LayoutSpec {
  /** 正文物理 pt = 标准 × PPT2PHYS × fontScale */
  bodyPt: number;
  /** 题注相对正文 em 比（0.75，随字号联动） */
  capEm: number;
  /** 页眉帧标题物理 pt = 标准 × 4/3 × PPT2PHYS（页级不变） */
  titlePt: number;
  /** 页脚物理 pt = 标准 × 2/3 × PPT2PHYS（页级不变） */
  footPt: number;
  lhNom: number; lhMin: number;
  paraGapNom: number; paraGapMin: number;
  itemGapNom: number; itemGapMin: number;
  /** 未显式 width 的图/视频自动宽（页宽比例，固定 0.75） */
  imgAutoW: number;
  /** 图限高起点（cqh，恒为 IMG_H_MAX；扫描器只在字/距到底后从此值压实） */
  imgHNom: number;
  /** 字号兜底下限（对 fit 系数而言）：FIT_MIN/fontScale，封顶 1 */
  fitMin: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (t: number, a: number, b: number) => a + (b - a) * t;

/** 计算页面排版规格（内容/双栏/目录页通用）。
 *  第廿九轮起图像尺寸完全由宽度权威 + 扫描器实测决定，不做文本量估算预压；
 *  仅剩一个内容判定：纯图页（无 paragraph/itemize/equation/annoeq/table）用更高的
 *  图高天花板 IMG_H_MAX_IMGONLY——55 对纯图页是人为损失（见常量注释）。 */
export function computeLayoutSpec(
  input: { blocks?: Block[]; fontScale?: number; fontSize?: number },
): LayoutSpec {
  const contentBlocks = (input.blocks ?? []).filter((b) => b.type !== 'colmark' && b.type !== 'colend');
  const imgOnly = contentBlocks.length > 0 && contentBlocks.every((b) => b.type === 'figure' || b.type === 'video');
  const standard = input.fontSize ?? 16;
  const scale = clamp(input.fontScale ?? 1, PAGE_FONT_MIN, PAGE_FONT_MAX);
  const bodyPt = standard * PPT2PHYS * scale;

  return {
    bodyPt,
    capEm: 0.75,
    titlePt: standard * (4 / 3) * PPT2PHYS,
    footPt: standard * (2 / 3) * PPT2PHYS,
    lhNom: 1.5, lhMin: 1.2,
    paraGapNom: 1.2, paraGapMin: 0.6,
    itemGapNom: 0.7, itemGapMin: 0.4,
    imgAutoW: 0.75,
    // 限高起点恒为天花板：放得下多少由扫描器实测（宽度权威，图最后压），不做估算预压；
    // 纯图页用更高天花板（见 IMG_H_MAX_IMGONLY 注释）
    imgHNom: imgOnly ? IMG_H_MAX_IMGONLY : IMG_H_MAX,
    fitMin: Math.min(1, FIT_MIN / scale),
  };
}

/** 间距压实度 s → 实际间距值（宽松端 → 紧凑端插值）。
 *  间距单一约定：所有块「段前 0、段后统一 --gap-para」——任意相邻块间距与类型组合无关，
 *  不存在「媒体块段前大段后小」的不对称（第十五轮修复） */
export function spacingFor(spec: LayoutSpec, s: number): {
  lh: number; paraGap: number; itemGap: number;
} {
  const t = clamp(s, 0, 1);
  return {
    lh: lerp(t, spec.lhNom, spec.lhMin),
    paraGap: lerp(t, spec.paraGapNom, spec.paraGapMin),
    itemGap: lerp(t, spec.itemGapNom, spec.itemGapMin),
  };
}

/** 标称排版状态（未压实）：宽松间距 + 图限高顶天 + 字号不压 */
export function defaultSpacing(spec: LayoutSpec): SpacingState {
  return { s: 0, imgH: spec.imgHNom, fit: 1 };
}

/** 压缩阶梯粗步（间距压实度 s 的离散档位：宽松 → 紧凑） */
export const S_LADDER = [0.25, 0.5, 0.75, 1];
/** 字号兜底步进（fit 每步 −0.05） */
export const FIT_STEP = 0.05;
/** 「放得下」判定容差（px）：溢出不超过此值视为放得下（亚像素级裁切不算溢出）。
 *  旧值 8：两图页末图带 3.5 布局 px 溢出「定居」，渗入底部 padding——上下留白
  *  不对称 6.7 显示 px（用户实测报障）；2px 兼顾亚像素噪声与对称性 */
export const FIT_TOL = 2;

/** 溢出探测回调：st → 溢出 px（scrollHeight − clientHeight，恒 ≥ 0） */
export type OverflowProbe = (st: SpacingState) => number;

/** 二分细化：lo 恒为失败态、hi 恒为成功态（数值大小关系不限，mid 取算术中点），
 *  沿 param 收敛到「距失败边界最近的成功值」——即该参数的最宽松可行值。
 *  语义按参数方向统一：s 收敛到最小可行（最松间距）、fit/imgH 收敛到最大可行（字号/图最大）。 */
function refineBetween(
  probe: OverflowProbe, lo: number, hi: number,
  param: 's' | 'fit' | 'imgH', base: SpacingState,
): number {
  let a = lo, b = hi;
  for (let i = 0; i < 6; i++) {
    const mid = (a + b) / 2;
    if (probe({ ...base, [param]: mid }) <= FIT_TOL) b = mid;
    else a = mid;
  }
  return b;
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** 压缩阶梯求解（纯函数）：粗步定位 + 连续细化，返回「放得下的最宽松状态」。
 *  次序合约（第廿九轮起）不变：① 间距（s，0→1）→ ② 字号（fit，s=1）→ ③ 图高（s=1+fit=fitMin）。
 *  每阶段粗步落定后对该阶段参数二分细化，消除粗步过冲（换行悬崖：字号/间距的微小变化
 *  会离散增删整行，5% 粗步可过冲数十 px，表现为「压得厉害却仍离页脚很远」）：
 *    ① 细化 s → 最小可行压实度；② 先细化 fit → s=1 下最大可行字号，再回松 s
 *    （字号优先于间距的合约取向：余量优先还给字号，剩余再用间距松度吸收）；
 *    ③ 细化 imgH → 最大可行图高。
 *  全程放不下时返回全程溢出最小态（容忍溢出，由调用方提示删减）。 */
export function compressBest(
  spec: LayoutSpec, probe: OverflowProbe,
): { st: SpacingState; over: number } {
  const fitMin = spec.fitMin;
  const nom = { imgH: spec.imgHNom, fit: 1 } as const;

  // 标称态（最宽松）
  let best = defaultSpacing(spec);
  let bestOver = probe(best);
  if (bestOver <= FIT_TOL) return { st: best, over: bestOver };

  // ① 间距阶梯：粗步找首个放得下的档，再细化 s（最小可行压实度）
  let prev = best; // 上一失败态（更宽松）
  for (const s of S_LADDER) {
    const st: SpacingState = { s, ...nom };
    const over = probe(st);
    if (over < bestOver) { best = st; bestOver = over; }
    if (over <= FIT_TOL) {
      const final: SpacingState = { s: round4(refineBetween(probe, prev.s, s, 's', st)), ...nom };
      return { st: final, over: probe(final) };
    }
    prev = st;
  }

  // ② 字号阶梯（间距已到最紧）：粗步找首个放得下的字号，先细化 fit（最大可行字号），
  //    再回松 s（用余量换更松间距——两轴都优于粗步结果，合约取向不破坏）
  prev = { s: 1, ...nom };
  for (let f = 1 - FIT_STEP; f >= fitMin - 0.005; f -= FIT_STEP) {
    const fit = Math.max(fitMin, Math.round(f * 100) / 100);
    const st: SpacingState = { s: 1, ...nom, fit };
    const over = probe(st);
    if (over < bestOver) { best = st; bestOver = over; }
    if (over <= FIT_TOL) {
      const fitRef = round4(refineBetween(probe, prev.fit, fit, 'fit', { s: 1, ...nom }));
      // 回松 s：s=0 也放得下（粗步严重过冲的罕见态）直接取 0，否则在 (0,1] 二分
      const base: SpacingState = { s: 1, ...nom, fit: fitRef };
      const sRef = probe({ ...base, s: 0 }) <= FIT_TOL
        ? 0
        : round4(refineBetween(probe, 0, 1, 's', base));
      const final: SpacingState = { s: sRef, ...nom, fit: fitRef };
      return { st: final, over: probe(final) };
    }
    prev = st;
  }

  // ③ 图高阶梯（字/距已到底）：粗步找首个放得下的图高，再细化 imgH（最大可行图高）
  let prevImg = spec.imgHNom;
  let imgH = spec.imgHNom;
  while (imgH > IMG_H_MIN + 0.5) {
    imgH = Math.max(IMG_H_MIN, imgH * 0.85);
    const st: SpacingState = { s: 1, imgH, fit: fitMin };
    const over = probe(st);
    if (over < bestOver) { best = st; bestOver = over; }
    if (over <= FIT_TOL) {
      const final: SpacingState = { s: 1, imgH: round4(refineBetween(probe, prevImg, imgH, 'imgH', { s: 1, imgH: spec.imgHNom, fit: fitMin })), fit: fitMin };
      return { st: final, over: probe(final) };
    }
    prevImg = imgH;
  }
  return { st: best, over: bestOver };
}

/** 规格 + 页级状态 → 注入 .sv 根 style 的 CSS 变量（header/footer/body 共享） */
export function layoutCssVars(spec: LayoutSpec, st: SpacingState): Record<string, string> {
  const sp = spacingFor(spec, st.s);
  return {
    '--fs-body': `${spec.bodyPt.toFixed(2)}pt`,
    '--fs-cap': `${spec.capEm.toFixed(3)}em`,
    '--fs-title': `${spec.titlePt.toFixed(2)}pt`,
    '--fs-foot': `${spec.footPt.toFixed(2)}pt`,
    '--lh': sp.lh.toFixed(2),
    '--gap-para': `${sp.paraGap.toFixed(2)}em`,
    '--gap-item': `${sp.itemGap.toFixed(2)}em`,
    '--img-auto-w': `${Math.round(spec.imgAutoW * 100)}%`,
    '--img-max-h': `${st.imgH.toFixed(1)}cqh`,
    '--body-fit': String(Math.round(st.fit * 1000) / 1000),
  };
}
