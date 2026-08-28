// 临时调查：annLabelText 对含 \sqrt 标注的输出 —— 已转为正式回归断言
import { describe, it, expect } from 'vitest';
import { annLabelText } from '../src/components/anno/engine';

describe('annLabelText：SVG path 数据不被 <br> 腐蚀（第卌九轮修复）', () => {
  it('用户场景：分母含 \\sqrt 的标注——根号 path 保持原始换行', () => {
    const text = '# Light Prop. $\\boldsymbol{D}\\left( \\boldsymbol{u} \\right) =\\frac{\\lambda \\boldsymbol{u}}{\\sqrt{1-\\lambda ^2|\\boldsymbol{u}|^2}}$';
    const html = annLabelText(text);
    // KaTeX 的 stretchy 路径（根号）以字面 \n 分段——必须原样保留
    expect(/d="[^"]*\n/.test(html)).toBe(true);
    // 全局 <br> 替换曾把 path 数据腐蚀成 M95,702<br>c-2.7... → 整条路径解析失败、根号消失
    expect(/d="[^"]*<br>/.test(html)).toBe(false);
    expect(html).toContain('M95,702\nc-2.7');
  });

  it('同族受影响结构：\\overbrace / \\underbrace / \\xrightarrow 的 path 同样不被腐蚀', () => {
    for (const tex of ['\\overbrace{abc}^{n}', '\\underbrace{abc}_{n}', 'a \\xrightarrow{\\text{def}} b']) {
      const html = annLabelText('$' + tex + '$');
      expect(/d="[^"]*<br>/.test(html)).toBe(false);
    }
  });

  it('文本段行为不变：\\\\ 换行仍转 <br>，转义与纯文本不受影响', () => {
    expect(annLabelText('a\\\\b')).toBe('a<br>b');
    expect(annLabelText('100\\% \\\\ done')).toBe('100% <br> done');
    expect(annLabelText('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
    // 文本换行与公式混排：文本段 \n → <br>，公式段保持原样
    const mixed = annLabelText('line1\nline2 $\\sqrt{x}$ end');
    expect(mixed.startsWith('line1<br>line2 <span class="katex"')).toBe(true);
    expect(/d="[^"]*<br>/.test(mixed)).toBe(false);
  });
});
