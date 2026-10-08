// Local fonts only: retain the Latin families and prefer screen-friendly CJK outlines.
const CJK = {
  serif: "'Source Han Serif CN', '思源宋体 CN', 'Noto Serif SC', 'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', SimSun, serif",
  sans: "'Source Han Sans CN', '思源黑体 CN', 'Noto Sans SC', 'Source Han Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

export function slideFontStack(en: 'serif' | 'sans', zh: 'serif' | 'sans'): string {
  return `${en === 'serif' ? "'Times New Roman'" : 'Arial'}, ${CJK[zh]}`;
}
