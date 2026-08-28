// 编辑态解析与展示态同源（第卅一轮修复回归）：
// 旧扁平正则在编辑态漏解析的三类构造会以源码直显（用户报障：着色段落编辑时显示
// [方法一…]{color=primary} 原文）——统一走 model/inline.ts tokenizeInline 后必须全修复
import { describe, it, expect } from 'vitest';
import { textToDoc, docToText } from '../src/editor/schema';

type Node = { type: string; text?: string; marks?: { type: string; attrs?: { role?: string } }[] };

const inlineNodes = (text: string): Node[] => {
  const doc = textToDoc(text) as { content: { content?: Node[] }[] };
  return doc.content[0].content ?? [];
};

describe('编辑态解析 = 展示态语法（单一 tokenizer）', () => {
  it('① span 内容含硬换行 \\n：解析为带 mark 的文本 + hardBreak，不再漏源码', () => {
    const nodes = inlineNodes('[方法一\n（数值计算-积分）：]{color=primary}');
    expect(nodes.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(nodes[0]).toMatchObject({ text: '方法一', marks: [{ type: 'colorSpan', attrs: { role: 'primary' } }] });
    expect(nodes[2]).toMatchObject({ text: '（数值计算-积分）：', marks: [{ type: 'colorSpan', attrs: { role: 'primary' } }] });
    // 源码不再以裸文本出现
    expect(JSON.stringify(nodes)).not.toContain('{color=');
  });

  it('② 粗体与着色嵌套：**[..]{color=x}** → bold+colorSpan 双 mark 文本', () => {
    const nodes = inlineNodes('**[重点]{color=primary}** 结论');
    const marked = nodes.find((n) => n.text === '重点');
    expect(marked?.marks?.map((m) => m.type).sort()).toEqual(['bold', 'colorSpan']);
    expect(docToText(textToDoc('**[重点]{color=primary}** 结论'))).toBe('**[重点]{color=primary}** 结论');
  });

  it('③ 非预设角色名：{color=blue} 编辑态同样解析（与展示态 [\w-]+ 宽容一致）', () => {
    const nodes = inlineNodes('[自定义色]{color=blue}');
    expect(nodes[0]).toMatchObject({ text: '自定义色', marks: [{ type: 'colorSpan', attrs: { role: 'blue' } }] });
  });

  it('用户场景整段：着色引导语 + 行内公式 + 硬换行，编辑态零源码泄漏', () => {
    const src = '[方法一（数值计算-积分）：]{color=primary} 计算 $I=\\int_0^1 f(x)\\,dx$\n第二行 [着色]{color=accent}';
    const json = JSON.stringify(inlineNodes(src));
    expect(json).toContain('colorSpan');
    expect(json).not.toMatch(/\{color=\w+\}/);
    expect(json).not.toContain('"text":"[');
  });

  it('嵌套 span 语法（first-]-wins）：编辑态与展示态逐令牌一致', () => {
    // 语法本身不支持方括号嵌套：外层 [ 匹配到内层 ]+{spec} 即闭合（展示态同款行为）
    const src = '[外 [内]{color=accent} 层]{color=primary}';
    const nodes = inlineNodes(src);
    expect(nodes[0]).toMatchObject({ text: '外 [内', marks: [{ type: 'colorSpan', attrs: { role: 'accent' } }] });
    expect(nodes[1]).toMatchObject({ text: ' 层]{color=primary}' });
    expect(docToText(textToDoc(src))).toBe(src); // 字面重组，往返稳定
  });

  it('公式芯片可被 span 包裹且往返稳定；latex 含 [ ] 时降级裸输出', () => {
    // 安全 latex：span 内公式 → 带色 mark 的 inlineMath，序列化还原为 span
    const doc = textToDoc('[$x^2$]{color=primary}') as { content: { content?: Node[] }[] };
    const chip = (doc.content[0].content ?? [])[0];
    expect(chip?.type).toBe('inlineMath');
    expect(chip?.marks?.[0]).toMatchObject({ type: 'colorSpan' });
    expect(docToText(doc)).toBe('[$x^2$]{color=primary}');
    // 用户改出含 [ ] 的 latex 后序列化必须降级裸 $..$——span 会被 tokenizer 截断漏垃圾
    const doc2 = JSON.parse(JSON.stringify(doc)) as typeof doc;
    doc2.content[0].content![0].attrs!.latex = 'x \\in [0,1]';
    expect(docToText(doc2)).toBe('$x \\in [0,1]$');
  });

  it('引用芯片恒裸输出（span 无法包裹 [@..]：ref 分支先于 span 截断）', () => {
    const doc = textToDoc('参见 [@eq:deck] 与 [@sec:method]') as { content: { content?: Node[] }[] };
    const chips = (doc.content[0].content ?? []).filter((n) => n.type === 'refChip');
    expect(chips).toHaveLength(2);
    expect(docToText(doc)).toBe('参见 [@eq:deck] 与 [@sec:method]');
  });

  it('既有行为保持：粗体/斜体/组合标记/硬换行/引用去重', () => {
    expect(docToText(textToDoc('斜 *体* 与 **粗**'))).toBe('斜 *体* 与 **粗**');
    expect(docToText(textToDoc('测试 [文字]{color=accent,bg=primary} 完'))).toBe('测试 [文字]{color=accent,bg=primary} 完');
    expect(docToText(textToDoc('第一行\n第二行'))).toBe('第一行\n第二行');
    expect(docToText(textToDoc('将[@eq:eq:pos]代入'))).toBe('将[@eq:pos]代入');
  });
});
