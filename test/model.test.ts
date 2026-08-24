// Markdown 合约往返 / 编号 / 引用解析 / annotate 预处理 合约测试

import { describe, it, expect } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '../src/model/markdown';
import { computeDeck, refDisplay, refParts } from '../src/model/numbering';
import { tokenizeInline, InlineToken } from '../src/model/inline';
import { preprocessMath } from '../src/components/MathView';
import { annoFromJson, annoToJson } from '../src/model/anno';
import { stripMathDelims } from '../src/components/LatexEditor';
import { defaultConfig } from '../src/model/types';

const SAMPLE = `---
beamerapp: 1
title: 测试汇报
authors: 张三^1; 李四^1,2
affiliations: 某某大学
date: "2026-08-19"
shortTitle: 测试
language: zh
aspect: "16:9"
numbering: continuous
fontZh: serif
fontEn: serif
sectionPages: true
logo: media/logo.svg
logoPos: "63,54.5,24"
palette:
  preset: academic-blue
---

:::: title
::::

:::: toc
::::

# 引言 {#sec:intro}

:::: slide title="研究背景"
科研写作中公式如 $E=mc^2$ 很重要，参见 [@eq:gauss] 与 [@fig:arch]、[@tab:perf]。

- 要点一 **加粗**
- 要点二 [着色]{color=accent}

$$ \\int_{-\\infty}^{+\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi} \\label{eq:gauss} $$

::: equation label="eq:z"
z = \\frac{x - \\mu}{\\sigma}
:::

::: annoeq label="eq:anno"
%%anno {"fontSize":30,"shade":17,"equalHeight":true,"fboxScale":0.5,"annFontScale":0.5,"labelFont":"auto","paletteIdx":2,"marks":[{"id":"mk1","name":"p1","type":"box","color":"#2A4FC7","needle":"x","occ":0}],"annotations":[{"id":"an1","type":"one","text":"变量 $x$","pos":"above","labelBelow":false,"colorAuto":true,"color":"#000000","xshift":0,"yshift":1,"markIds":["mk1"]}]}
z = x + \\mu
:::

::: figure src="media/1.jpg" width="0.6" label="fig:arch" caption="架构图"
:::

::: notes
本页讲背景。
:::
::::

:::: slide layout="twoCol" ratio="0.5"
::: col
左栏文字，含 [@sec:intro] 引用。
::: col
::: table label="tab:perf" caption="耗时对比"
| 方式 | 耗时 |
| --- | --- |
| Word | 35 min |
| LaTeX \\| 转义 | 20 min |
:::
::::

:::: slide layout="content"
::: video src="media/demo.mp4" width="0.8" autoplay="false"
:::
::::

:::: slide layout="end" title="谢谢"
::::
`;

describe('markdown contract', () => {
  it('parse -> serialize -> parse 幂等（serialize 稳定）', () => {
    const deck = parseMarkdown(SAMPLE);
    const md1 = serializeMarkdown(deck);
    const md2 = serializeMarkdown(parseMarkdown(md1));
    expect(md2).toBe(md1);
  });

  it('解析 front-matter 与结构', () => {
    const deck = parseMarkdown(SAMPLE);
    expect(deck.config.title).toBe('测试汇报');
    expect(deck.config.language).toBe('zh');
    expect(deck.config.logo).toBe('media/logo.svg');
    expect(deck.config.logoPos).toEqual({ x: 63, y: 54.5, w: 24 });
    const sections = deck.items.filter((x) => x.kind === 'section');
    expect(sections).toHaveLength(1);
    if (sections[0].kind === 'section') {
      expect(sections[0].section.title).toBe('引言');
      expect(sections[0].section.label).toBe('sec:intro');
    }
  });

  it('块解析：公式 label（$$ 与 ::: equation）、表格转义、视频属性、notes', () => {
    const deck = parseMarkdown(SAMPLE);
    const slides = deck.items.filter((x) => x.kind === 'slide').map((x) => (x.kind === 'slide' ? x.slide : null));
    const all = slides.flatMap((s) => (s ? s.blocks : []));
    const eqs = all.filter((b) => b.type === 'equation');
    expect(eqs).toHaveLength(2);
    expect(eqs[0].label).toBe('eq:gauss');
    expect(eqs[0].latex).not.toContain('\\label');
    const tabs = all.filter((b) => b.type === 'table');
    expect(tabs[0].cells).toHaveLength(3);
    expect(tabs[0].cells![2][0]).toBe('LaTeX | 转义');
    const vids = all.filter((b) => b.type === 'video');
    expect(vids[0].src).toBe('media/demo.mp4');
    expect(vids[0].autoplay).toBe(false);
    const figs = all.filter((b) => b.type === 'figure');
    expect(figs[0].width).toBeCloseTo(0.6);
    const first = slides[2];
    expect(first?.notes).toBe('本页讲背景。');
  });

  it('twoCol 栏标记与 ratio', () => {
    const deck = parseMarkdown(SAMPLE);
    const two = deck.items.find((x) => x.kind === 'slide' && x.slide.layout === 'twoCol');
    expect(two && two.kind === 'slide' && two.slide.ratio).toBeCloseTo(0.5);
    const marks = two && two.kind === 'slide' ? two.slide.blocks.filter((b) => b.type === 'colmark') : [];
    expect(marks).toHaveLength(2);
  });
});

describe('numbering & refs', () => {
  const deck = parseMarkdown(SAMPLE);
  const c = computeDeck(deck);

  it('页面序列含自动节分隔页与页码', () => {
    // title, toc, divider, 背景, twoCol, video, end = 7 页
    expect(c.pages).toHaveLength(7);
    expect(c.pages[0].no).toBe(1);
    expect(c.pages[2].kind).toBe('divider');
    expect(c.pages[0].kind).toBe('slide');
  });

  it('公式/图/表连续编号与 label 索引', () => {
    expect(c.equationNumByLabel.get('eq:gauss')).toBe('1');
    expect(c.equationNumByLabel.get('eq:z')).toBe('2');
    expect(c.figureNumByLabel.get('fig:arch')).toBe('1');
    expect(c.tableNumByLabel.get('tab:perf')).toBe('1');
    expect(c.labelPageIndex.get('fig:arch')).toBe(3);
  });

  it('按节编号模式', () => {
    const d2 = { ...deck, config: { ...deck.config, numbering: 'perSection' as const } };
    const c2 = computeDeck(d2);
    expect(c2.equationNumByLabel.get('eq:gauss')).toBe('1.1');
  });

  it('引用显示（中英文）', () => {
    expect(refDisplay('eq', 'gauss', c, 'zh')).toBe('式 (1)');
    expect(refDisplay('eq', 'gauss', c, 'en')).toBe('Eq. (1)');
    expect(refDisplay('fig', 'arch', c, 'zh')).toBe('图 1');
    expect(refDisplay('tab', 'perf', c, 'en')).toBe('Table 1');
    expect(refDisplay('sec', 'intro', c, 'zh')).toBe('第 1 节');
    expect(refDisplay('eq', 'missing', c, 'zh')).toBeNull();
  });

  it('refParts 只接受合法标签', () => {
    expect(refParts('eq:x')?.key).toBe('x');
    expect(refParts('cite:x')).toBeNull();
    expect(refParts('nocolon')).toBeNull();
  });
});

describe('annoeq 注释公式块', () => {
  const deck = parseMarkdown(SAMPLE);
  const slides = deck.items.filter((x) => x.kind === 'slide').map((x) => (x.kind === 'slide' ? x.slide : null));
  const all = slides.flatMap((s) => (s ? s.blocks : []));
  const anno = all.find((b) => b.type === 'annoeq');

  it('解析标注数据（latex/label/marks/annotations/样式）', () => {
    expect(anno).toBeDefined();
    expect(anno!.latex).toBe('z = x + \\mu');
    expect(anno!.label).toBe('eq:anno');
    expect(anno!.anno?.marks[0]).toMatchObject({ name: 'p1', type: 'box', color: '#2A4FC7', needle: 'x', occ: 0 });
    expect(anno!.anno?.annotations[0]).toMatchObject({ type: 'one', text: '变量 $x$', pos: 'above', markIds: ['mk1'] });
    expect(anno!.anno?.fontSize).toBe(30);
  });

  it('与 equation 共用公式编号序列（自动编号 + label 引用）', () => {
    const c = computeDeck(deck);
    expect(c.equationNumByLabel.get('eq:gauss')).toBe('1');
    expect(c.equationNumByLabel.get('eq:z')).toBe('2');
    expect(c.equationNumByLabel.get('eq:anno')).toBe('3');
    expect(c.labelPageIndex.get('eq:anno')).toBe(3);
  });

  it('annoFromJson 容错：坏 JSON 回默认、悬空 markIds 剔除、越界值钳制', () => {
    expect(annoFromJson('not json').marks).toHaveLength(0);
    expect(annoFromJson(undefined).annotations).toHaveLength(0);
    const s = annoFromJson('{"marks":[{"id":"a","name":"m","type":"box","needle":"x","occ":0}],'
      + '"annotations":[{"id":"b","type":"one","markIds":["a","zzz"],"text":"t"}],'
      + '"fontSize":999,"scale":5,"shade":-5,"annFontScale":3,"fboxScale":2,"labelFont":"mono"}');
    expect(s.fontSize).toBe(60);
    expect(s.scale).toBe(2); // 展示放大限定 50%–200%（第卅一轮）
    expect(s.shade).toBe(0);
    expect(s.annFontScale).toBe(1);
    expect(s.fboxScale).toBe(1);
    expect(s.labelFont).toBe('auto');
    expect(s.annotations[0].markIds).toEqual(['a']);
    expect(annoToJson(s)).toBe(JSON.stringify(s));
  });

  it('stripMathDelims：整体 $..$ / $$..$$ 包裹去包裹，非整体包裹不动', () => {
    expect(stripMathDelims('$$E=mc^2$$')).toBe('E=mc^2');
    expect(stripMathDelims('$E=mc^2$')).toBe('E=mc^2');
    expect(stripMathDelims('  $$\\frac{a}{b}$$  ')).toBe('\\frac{a}{b}');
    expect(stripMathDelims('$$x$$ + $y$')).toBe('$$x$$ + $y$'); // 前后有内容
    expect(stripMathDelims('a$b$')).toBe('a$b$');
    expect(stripMathDelims('$$')).toBe('$$');   // 退化输入不动
    expect(stripMathDelims('$')).toBe('$');
    expect(stripMathDelims('x = 1')).toBe('x = 1');
  });
});

describe('inline tokenizer', () => {
  it('行内公式 / 引用 / 着色 / 粗体', () => {
    const toks = tokenizeInline('公式 $x^2$ 与 [@eq:a] 和 [红]{color=accent} 及 **粗** *斜*');
    expect(toks.map((t) => t.t)).toEqual(['text', 'math', 'text', 'ref', 'text', 'color', 'text', 'bold', 'text', 'italic']);
  });
  it('底色 [文字]{bg=角色}', () => {
    const toks = tokenizeInline('前文 [重点]{bg=emphasis} 后文');
    expect(toks.map((t) => t.t)).toEqual(['text', 'bg', 'text']);
    expect(toks[1]).toMatchObject({ role: 'emphasis' });
  });
  it('未闭合 $ 保持原文', () => {
    const toks = tokenizeInline('a $ b');
    expect(toks[0]).toMatchObject({ t: 'text' });
  });
});

describe('annotate preprocessing', () => {  const palette = defaultConfig.palette;

  it('\\annotate 转着色下划线 + 图例', () => {
    const src = 'z = \\annotate[accent]{\\mu}{均值} + \\annotate[primary,box]{\\sigma}{标准差}';
    const { tex, legend } = preprocessMath(src, palette);
    expect(tex).toContain('\\textcolor{#E8912D}{\\underline{\\mu}}');
    expect(tex).toContain('\\textcolor{#0F66AD}{\\boxed{\\sigma}}');
    expect(legend).toHaveLength(2);
    expect(legend[0].text).toBe('均值');
    expect(legend[1].box).toBe(true);
  });

  it('\\textcolor 角色名解析为 hex', () => {
    const { tex } = preprocessMath('\\textcolor{accent}{x} + \\textcolor{#A03232}{y}', palette);
    expect(tex).toContain('\\textcolor{#E8912D}{x}');
    expect(tex).toContain('#A03232');
  });
});


describe('refPageIndex（统一引用解析）', () => {
  const c = computeDeck(parseMarkdown(SAMPLE));

  it('eq/fig/tab/sec label → 所在页 index', async () => {
    const { refPageIndex } = await import('../src/model/numbering');
    // 页面序列：0 title, 1 toc, 2 divider, 3 背景, 4 twoCol, 5 video, 6 end
    expect(refPageIndex('eq:gauss', c)).toBe(3);
    expect(refPageIndex('fig:arch', c)).toBe(3);
    expect(refPageIndex('tab:perf', c)).toBe(4);
    expect(refPageIndex('sec:intro', c)).toBe(2); // 节首页（分隔页）
    expect(refPageIndex('eq:missing', c)).toBeNull();
  });
});

describe('节创建与改名（面包屑交互下沉逻辑）', () => {
  it('addSectionBefore 在指定页前插入 level 2/3 节并参与编号；renameSection 按 id 改名', async () => {
    const { useStore } = await import('../src/state/store');
    const s = useStore.getState();
    s.loadProjectData({ md: SAMPLE, folder: '/tmp/x' });
    const st = useStore.getState();
    // SAMPLE 的第三张内容页（video 页）前插入小节
    const slides = st.deck.items.filter((x) => x.kind === 'slide');
    const videoSlide = slides[3];
    if (videoSlide.kind !== 'slide') throw new Error('unreachable');
    st.addSectionBefore(videoSlide.slide.id, '实现细节', 2);

    const after = useStore.getState();
    const secs = after.deck.items.filter((x) => x.kind === 'section');
    expect(secs).toHaveLength(2);
    if (secs[1].kind === 'section') {
      expect(secs[1].section.level).toBe(2);
      expect(after.computed.sectionNum.get(secs[1].section.id)).toBe('1.1');
      // 小节应位于 video 页 item 之前
      const idxSec = after.deck.items.findIndex((x) => x.kind === 'section' && x.section.title === '实现细节');
      const idxVid = after.deck.items.findIndex((x) => x.kind === 'slide' && x.slide.id === videoSlide.slide.id);
      expect(idxSec).toBe(idxVid - 1);
      // 按 id 改名（面包屑每段独立编辑的核心）
      after.renameSection(secs[1].section.id, '实现与优化');
      const renamed = useStore.getState().deck.items[idxSec];
      expect(renamed.kind === 'section' && renamed.section.title).toBe('实现与优化');
      // level 3 子小节编号
      useStore.getState().addSectionBefore(videoSlide.slide.id, '子小节', 3);
      const thirds = useStore.getState().deck.items.filter((x) => x.kind === 'section');
      if (thirds[2].kind === 'section') {
        expect(useStore.getState().computed.sectionNum.get(thirds[2].section.id)).toBe('1.1.1');
      }
    }
  });
});


describe('组合标记与编辑器往返（所见即所得）', () => {
  it('tokenizer：组合语法 {color=x,bg=y} → color 外包 bg', () => {
    const toks = tokenizeInline('测试 [文字]{color=accent,bg=primary} 完毕');
    expect(toks.map((t) => t.t)).toEqual(['text', 'color', 'text']);
    const c = toks[1] as { children: InlineToken[] };
    expect(c.children[0].t).toBe('bg');
    expect((c.children[0] as { children: InlineToken[] }).children[0]).toMatchObject({ t: 'text', v: '文字' });
  });

  it('schema 往返：{color=accent,bg=primary} / 粗体+底色 / 斜体 均幂等', async () => {
    const { textToDoc, docToText } = await import('../src/editor/schema');
    expect(docToText(textToDoc('测试 [文字]{color=accent,bg=primary} 完')) as string)
      .toBe('测试 [文字]{color=accent,bg=primary} 完');
    expect(docToText(textToDoc('加 **[重点]{bg=emphasis}** 粗')) as string)
      .toBe('加 **[重点]{bg=emphasis}** 粗');
    expect(docToText(textToDoc('斜 *体* 与 **粗** 并存')) as string)
      .toBe('斜 *体* 与 **粗** 并存');
  });

  it('schema 进入编辑不裸露 ** 源码（粗斜体解析为 mark）', async () => {
    const { textToDoc } = await import('../src/editor/schema');
    const doc = textToDoc('有 **粗体** 与 *斜体*') as { content: { content: { type: string; text?: string; marks?: { type: string }[] }[] }[] };
    const nodes = doc.content[0].content;
    expect(nodes.map((n) => n.type)).toEqual(['text', 'text', 'text', 'text']);
    expect(nodes[1]).toMatchObject({ text: '粗体', marks: [{ type: 'bold' }] });
    expect(nodes[3]).toMatchObject({ text: '斜体', marks: [{ type: 'italic' }] });
    // 序列化不裸露任何 ** 或 {color=}/{bg=} 之外的内容
    expect(nodes.every((n) => !(n.text || '').includes('**'))).toBe(true);
  });
});

describe('块内硬换行（Shift+Enter）全链路', () => {
  it('schema：textToDoc 把 \\n 拆成 hardBreak 节点；docToText 还原为 \\n', async () => {
    const { textToDoc, docToText } = await import('../src/editor/schema');
    const doc = textToDoc('第一行\n第二行 $x^2$') as { content: { content: { type: string }[] }[] };
    const nodes = doc.content[0].content;
    expect(nodes.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text', 'inlineMath']);
    expect(docToText(textToDoc('第一行\n第二行'))).toBe('第一行\n第二行');
  });

  it('md 合约：\\n 序列化为 Pandoc 式行尾反斜杠；解析还原；往返幂等', () => {
    const MD0 = '---\nbeamerapp: 1\n---\n\n:::: slide title="换行"\n第一行\\\n第二行 $E=mc^2$\n::::\n';
    const deck = parseMarkdown(MD0);
    const sl = deck.items[0];
    const text = sl.kind === 'slide' ? sl.slide.blocks[0].text : undefined;
    expect(text).toBe('第一行\n第二行 $E=mc^2$');
    const md1 = serializeMarkdown(deck);
    expect(md1).toContain('第一行\\\n第二行');
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });

  it('行尾双反斜杠（\\\\）不是硬换行标记（按普通空格连接）', () => {
    // md 行1 以两个字面反斜杠结尾（源码 4 个 \\ = 实际 2 个）→ 不触发硬换行
    const deck = parseMarkdown('---\nbeamerapp: 1\n---\n\n:::: slide\n末行双反斜杠\\\\\n下一行\n::::\n');
    const sl = deck.items[0];
    const text = sl.kind === 'slide' ? sl.slide.blocks[0].text : undefined;
    expect(text).toBe('末行双反斜杠\\\\ 下一行');
  });
});

describe('第卅二轮审查修复：空列表项 / 表格分隔行 / 行尾反斜杠往返 / BOM', () => {
  it('空列表项：裸 "-" 行解析为空项；模型序列化-再解析往返不变（不再变 "-" 段落）', () => {
    const MD = '---\nbeamerapp: 1\n---\n\n:::: slide\n- 甲\n- \n- 丙\n::::\n';
    const deck = parseMarkdown(MD);
    const sl = deck.items[0];
    const items = sl.kind === 'slide' && sl.slide.blocks[0].type === 'itemize' ? sl.slide.blocks[0].items : null;
    expect(items).toEqual(['甲', '', '丙']);
    const md1 = serializeMarkdown(deck);
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });

  it('表格：全空单元格行与单短横占位行是数据行（分隔行须每列 ≥2 短横）', () => {
    const MD = '---\nbeamerapp: 1\n---\n\n:::: slide\n::: table label="tab:edge"\n| a | b |\n| --- | --- |\n|  |  |\n| - | - |\n:::\n::::\n';
    const deck = parseMarkdown(MD);
    const sl = deck.items[0];
    const t = sl.kind === 'slide' ? sl.slide.blocks.find((b) => b.type === 'table') : undefined;
    expect(t?.cells).toEqual([['a', 'b'], ['', ''], ['-', '-']]);
    const md1 = serializeMarkdown(deck);
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });

  it('硬换行遇行尾字面反斜杠：往返不丢换行、反斜杠个数不变（k=0..3）', () => {
    const mk = (n: number) => {
      const deck = parseMarkdown('---\nbeamerapp: 1\n---\n\n:::: slide\n占位\n::::\n');
      const it = deck.items[0];
      if (it.kind === 'slide') it.slide.blocks = [{ id: 'b1', type: 'paragraph', text: 'a' + '\\'.repeat(n) + '\nb' }];
      return deck;
    };
    for (const n of [0, 1, 2, 3]) {
      const md1 = serializeMarkdown(mk(n));
      const back = parseMarkdown(md1);
      const it = back.items[0];
      const text = it.kind === 'slide' ? it.slide.blocks[0].text : '';
      expect(text).toBe('a' + '\\'.repeat(n) + '\nb');
      expect(serializeMarkdown(back)).toBe(md1);
    }
  });

  it('带 BOM 的 deck.md：前言仍生效（配置不回落默认、yaml 不泄漏成正文页）', () => {
    const deck = parseMarkdown('￻---\nbeamerapp: 1\ntitle: 带BOM\n---\n\n:::: slide\n正文\n::::\n'.replace('￻', '\uFEFF'));
    expect(deck.config.title).toBe('带BOM');
    expect(deck.items).toHaveLength(1);
  });
});

describe('表格 width 属性（第十五轮边缘拖拽/弹窗共用的显式宽度）', () => {
  it('::: table width="0.7" 解析 → 序列化回写 → 往返幂等', () => {
    const MD = '---\nbeamerapp: 1\n---\n\n:::: slide\n::: table width="0.7" label="tab:t" caption="对比"\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n:::\n::::\n';
    const deck = parseMarkdown(MD);
    const sl = deck.items[0];
    const t = sl.kind === 'slide' ? sl.slide.blocks.find((b) => b.type === 'table') : undefined;
    expect(t?.width).toBeCloseTo(0.7);
    const md1 = serializeMarkdown(deck);
    expect(md1).toContain('width="0.7"');
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });
});

describe('表格空单元格（第廿一轮修复：空首/尾单元格按内容丢弃导致丢列与往返漂移）', () => {
  it('空首/尾单元格保留（按位置剥外管道，不按内容 shift/pop）；往返幂等', () => {
    const MD = '---\nbeamerapp: 1\n---\n\n:::: slide\n::: table\n|  | b |  |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n:::\n::::\n';
    const deck = parseMarkdown(MD);
    const sl = deck.items[0];
    const t = sl.kind === 'slide' ? sl.slide.blocks.find((b) => b.type === 'table') : undefined;
    expect(t?.cells?.[0]).toEqual(['', 'b', '']);
    expect(t?.cells?.[1]).toEqual(['1', '2', '3']);
    const md1 = serializeMarkdown(deck);
    expect(serializeMarkdown(parseMarkdown(md1))).toBe(md1);
  });

  it('行首外管道可省（无 | 前缀的行同样解析）；末单元格内容 \\| 不被误剥', () => {
    const MD = '---\nbeamerapp: 1\n---\n\n:::: slide\n::: table\na | b\n--- | ---\nc | d\n| x \\| y | z |\n:::\n::::\n';
    const deck = parseMarkdown(MD);
    const sl = deck.items[0];
    const t = sl.kind === 'slide' ? sl.slide.blocks.find((b) => b.type === 'table') : undefined;
    expect(t?.cells).toEqual([['a', 'b'], ['c', 'd'], ['x | y', 'z']]);
    expect(serializeMarkdown(parseMarkdown(serializeMarkdown(deck)))).toBe(serializeMarkdown(deck));
  });
});

describe('示例工程完整性（examples/ 随包发布，用户首见内容）', () => {
  it('zh/en 示例解析 + 往返幂等 + 双单位封面', async () => {
    const fs = await import('fs');
    for (const name of ['zh_talk', 'en_talk']) {
      const md = fs.readFileSync(`examples/${name}/deck.md`, 'utf8');
      const deck = parseMarkdown(md);
      expect(serializeMarkdown(parseMarkdown(serializeMarkdown(deck)))).toBe(serializeMarkdown(deck));
      // 作者上标 ^1 ^2 与单位清单一一对应（封面单位展开的数据前提）
      expect(deck.config.affiliations.split(';').map((s) => s.trim()).filter(Boolean)).toHaveLength(2);
    }
  });
});
