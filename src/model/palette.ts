// 配色预设与 CSS 变量生成：每角色两档色（base/deep），微渐变自动生成

import { CSSProperties } from 'react';
import { Palette } from './types';

export const PRESETS: Record<string, Palette> = {
  'academic-blue': {
    primary: { base: '#0F66AD', deep: '#0A4373' },
    accent: { base: '#E8912D', deep: '#B96A12' },
    emphasis: { base: '#2E9E6B', deep: '#1D7A50' },
    text: '#1F2328',
    textMuted: '#5A6470',
    bg: '#FFFFFF',
    bgAlt: '#F2F5F9',
  },
  'forest-green': {
    primary: { base: '#1D7A4F', deep: '#125033' },
    accent: { base: '#C9822D', deep: '#96591A' },
    emphasis: { base: '#2E6FA8', deep: '#1D4C77' },
    text: '#1E2422',
    textMuted: '#586361',
    bg: '#FFFFFF',
    bgAlt: '#F1F6F3',
  },
  'crimson-red': {
    primary: { base: '#A03232', deep: '#6F1F1F' },
    accent: { base: '#C9822D', deep: '#96591A' },
    emphasis: { base: '#2E6FA8', deep: '#1D4C77' },
    text: '#251F1F',
    textMuted: '#665A5A',
    bg: '#FFFFFF',
    bgAlt: '#F8F2F2',
  },
  'slate-violet': {
    primary: { base: '#5B4E9E', deep: '#3B3270' },
    accent: { base: '#D4793F', deep: '#A45523' },
    emphasis: { base: '#2E9E6B', deep: '#1D7A50' },
    text: '#211F2A',
    textMuted: '#5D5A6E',
    bg: '#FFFFFF',
    bgAlt: '#F3F2F8',
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

const grad = (t: { base: string; deep: string }) => `linear-gradient(135deg, ${t.base} 0%, ${t.deep} 100%)`;

/** deck 根元素 style：CSS 变量注入
 *  CSS 自定义属性不在 csstype 的 CSSProperties 类型内，结构上与其兼容 */
export function paletteVars(p: Palette): CSSProperties {
  const vars: Record<string, string> = {
    '--p-base': p.primary.base,
    '--p-deep': p.primary.deep,
    '--p-grad': grad(p.primary),
    '--pa-base': p.accent.base,
    '--pa-deep': p.accent.deep,
    '--pa-grad': grad(p.accent),
    '--pe-base': p.emphasis.base,
    '--pe-deep': p.emphasis.deep,
    '--pe-grad': grad(p.emphasis),
    '--p-text': p.text,
    '--p-muted': p.textMuted,
    '--p-bg': p.bg,
    '--p-bgalt': p.bgAlt,
  };
  return vars as unknown as CSSProperties;
}

/** 角色名 -> CSS 变量（用于 DOM 着色） */
export function roleColorVar(role: string): string {
  switch (role) {
    case 'primary': return 'var(--p-base)';
    case 'accent': return 'var(--pa-base)';
    case 'emphasis': return 'var(--pe-base)';
    case 'muted': return 'var(--p-muted)';
    case 'text': return 'var(--p-text)';
    default: return role; // 未知角色：原样透传
  }
}

/** 角色名 -> 具体 hex（用于 KaTeX \textcolor：不吃 CSS 变量时报错，统一解析掉） */
export function resolveRole(p: Palette, role: string): string {
  switch (role) {
    case 'primary': return p.primary.base;
    case 'primaryDeep': return p.primary.deep;
    case 'accent': return p.accent.base;
    case 'accentDeep': return p.accent.deep;
    case 'emphasis': return p.emphasis.base;
    case 'emphasisDeep': return p.emphasis.deep;
    case 'muted': return p.textMuted;
    case 'text': return p.text;
    default: return role;
  }
}
