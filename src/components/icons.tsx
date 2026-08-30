// 通用 SVG 图标集（16×16、currentColor、strokeWidth 1.5-1.8、round cap/join）
// 与 Present.tsx 控件条图标同一家族；块工具条/胶片/缩放条等处共用，
// 替换原 emoji 字符（⧉📋🗑＋ 等）在不同系统字体下渲染不一致、与线条图标混排突兀的问题。
import { ReactNode } from 'react';

export function Ico({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>{children}</svg>;
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** 上移（块工具条） */
export const IcoUp = () => <Ico><path d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7" {...S} /></Ico>;

/** 下移（块工具条） */
export const IcoDown = () => <Ico><path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" {...S} /></Ico>;

/** 复制块（双层方，前层实） */
export const IcoCopy = () => <Ico><rect x="5.5" y="5.5" width="8" height="8" rx="1.4" {...S} /><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1.5" {...S} /></Ico>;

/** 粘贴块（剪贴板 + 落块） */
export const IcoPaste = () => <Ico><rect x="3" y="3" width="10" height="11" rx="1.4" {...S} /><rect x="5.5" y="1.8" width="5" height="2.6" rx="0.8" {...S} /><path d="M5.6 9.2l1.8 1.8 3-3.4" {...S} /></Ico>;

/** 插入（＋） */
export const IcoPlus = () => <Ico><path d="M8 3v10M3 8h10" {...S} /></Ico>;

/** 删除（垃圾桶） */
export const IcoTrash = () => <Ico><path d="M2.8 4.5h10.4M6.2 2.2h3.6M6 7v4.2M10 7v4.2M4 4.5l.7 8.2a1.4 1.4 0 0 0 1.4 1.3h3.8a1.4 1.4 0 0 0 1.4-1.3l.7-8.2" {...S} /></Ico>;

/** 关闭（✕） */
export const IcoClose = () => <Ico><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></Ico>;

/** 重置（⟳） */
export const IcoReset = () => <Ico><path d="M13 8A5 5 0 1 1 8 3c1.9 0 3.5 1 4.3 2.6" {...S} /><path d="M12.9 2.4v3.2h-3.2" {...S} /></Ico>;

/** 放大镜（图片缩放按钮） */
export const IcoLens = () => <Ico><circle cx="7" cy="7" r="4.2" {...S} strokeWidth={1.6} /><path d="M10.3 10.3 13.6 13.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></Ico>;

/** 放大 */
export const IcoZoomIn = () => <Ico><path d="M4 8h8M8 4v8" {...S} /></Ico>;

/** 缩小 */
export const IcoZoomOut = () => <Ico><path d="M4 8h8" {...S} /></Ico>;


