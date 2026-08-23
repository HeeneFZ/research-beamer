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

import { Aspect, Block } from './types';

/** PPT 等效 pt → 本页物理 pt：标准幻灯片 10in(254mm) 宽 → 本页 16:9 为 160mm 宽 */
export const PPT2PHYS = 160 / 254;

/** 字号兜底下限 = 标准 × 60%（全局不变量） */
export const FIT_MIN = 0.6;
/** 每页 fontScale 允许范围 */
export const PAGE_FONT_MIN = 0.6;
export const PAGE_FONT_MAX = 1.5;
/** 图限高边界（cqh）：起点恒为 MAX（天花板）；MIN 为扫描器压实下限 */
export const IMG_H_MIN = 16;
export const IMG_H_MAX = 55;

/** 页级排版状态（扫描器产出，存 store.pageLayout，内存态不写 md） */
export interface SpacingState {
  /** 间距压实度 0=宽松 → 1=紧凑 */
  s: number;
  /** 图/视频限高（cqh） */
  imgH: number;
  /** 字号兜底系数（1=正常；下限 spec.fitMin） */
  fit: number;
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
 *  Block[] 形参为 API 兼容保留：第廿九轮起图像尺寸完全由宽度权威 + 扫描器实测决定，
 *  规格不再读页面内容（旧 estTextHeight 文本量估算预压已整体删除）。
 *  字阶与 aspect 有意无关（物理锚定）：同一 fontSize 在 4:3/16:9 上为相同物理 pt，
 *  4:3 页宽更窄、相对占比更大——PPT 4:3 画布（10in 宽）上文字相对亦更大，语义一致。 */
export function computeLayoutSpec(
  input: { blocks?: Block[]; fontScale?: number; fontSize?: number },
): LayoutSpec {
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
    // 限高起点恒为天花板：放得下多少由扫描器实测（宽度权威，图最后压），不做估算预压
    imgHNom: IMG_H_MAX,
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
