---
beamerapp: 1
title: 基于深度学习的科技文本自动排版方法
authors: 张三^1; 李四^1,2
affiliations: 某某大学 计算机科学与技术学院; 某某人工智能研究院
date: 2026 年 8 月 19 日
shortTitle: 深度学习自动排版
language: zh
aspect: "16:9"
numbering: continuous
fontZh: serif
fontEn: serif
sectionPages: true
fontSize: 16
logo: media/高校logo.svg
logoPos: null
palette:
  preset: academic-blue
  primary:
    base: "#0F66AD"
    deep: "#0A4373"
  accent:
    base: "#E8912D"
    deep: "#B96A12"
  emphasis:
    base: "#2E9E6B"
    deep: "#1D7A50"
  text: "#1F2328"
  textMuted: "#5A6470"
  bg: "#FFFFFF"
  bgAlt: "#F2F5F9"
---

:::: title
::::

:::: toc
::::

# 引言 {#sec:intro}

:::: slide layout="content" title="研究背景与动机"

科技写作中的排版工作长期依赖手工调整。传统工作流存在两类痛点：

- **PowerPoint**：元素手动排布繁琐，数学公式与文字混排能力弱
- **LaTeX Beamer**：排版质量高，但全部手写代码、学习曲线陡峭

一个折中方案是以 Markdown 为中心的[可视化排版工具]{bg=emphasis}，如 [@sec:method] 所示的研究路线。

::: notes
开场 1 分钟：从自身写组会汇报的痛点切入，引出「Markdown + 可视化微调」的定位。
:::
::::

:::: slide layout="content" title="相关工作"

近年出现的 Markdown 演示工具各有侧重：

- Slidev / Marp：开发者友好，但学术元素（三线表、公式编号）支持有限
- Texslide：贴近 LaTeX 生态，但无可视化编辑

本文工作的目标是：**保留 Markdown 的简洁**，[补齐学术排版的能力]{color=accent}。

::: notes
一句话带过竞品；强调「折中」定位：比 Slidev 学术、比 Beamer 易用。
:::
::::

# 方法 {#sec:method}

## 整体架构

:::: slide layout="content" title="系统整体架构"

系统采用「内容与版式分离」的三层架构：

- **内容层**：deck.md（Markdown 合约）+ media/ 媒体文件夹
- **计算层**：自动编号（节/公式/图/表）、目录与页码生成
- **渲染层**：版式主题（微渐变配色）、放映与导出

核心思想可概括为

::: equation label="eq:deck"
\text{Deck} = \mathcal{C}(\text{content}) \oplus \mathcal{R}(\text{theme})
:::

其中 $\mathcal{C}$ 为内容编译算子，$\mathcal{R}$ 为版式渲染算子，如 [@eq:deck] 所示。
::::

## 编号与引用机制

:::: slide layout="content" title="公式注释与引用"

交叉引用统一采用 Pandoc 风格标签：节 [@sec:intro]、公式 [@eq:deck]、图 [@fig:arch]、表 [@tab:perf]。

公式支持 annotate-equations 风格的注释，实现「逐项讲解」：

::: equation label="eq:norm"
z = \frac{x - \mu}{\sigma}, \quad \annotate[accent]{\mu}{均值：数据中心}, \quad \annotate[primary,box]{\sigma}{标准差：离散度}
:::

更复杂的复杂度公式可用「注释公式块」逐项引线标注，见 [@eq:complexity]：

::: annoeq label="eq:complexity"
%%anno {"fontSize":30,"scale":1.3,"shade":17,"equalHeight":true,"fboxScale":0.5,"annFontScale":0.5,"labelFont":"auto","paletteIdx":5,"marks":[{"id":"p1","name":"p1","type":"box","color":"#2A4FC7","needle":"p","occ":0},{"id":"k1","name":"k1","type":"box","color":"#4E9A2E","needle":"κ","occ":0},{"id":"T1","name":"T1","type":"box","color":"#E61A8C","needle":"T","occ":0},{"id":"p2","name":"p2","type":"box","color":"#2A4FC7","needle":"p","occ":1},{"id":"k2","name":"k2","type":"text","color":"#4E9A2E","needle":"κ","occ":1},{"id":"T2","name":"T2","type":"box","color":"#E61A8C","needle":"T","occ":1},{"id":"Is","name":"Is","type":"plain","color":null,"needle":"I","occ":0},{"id":"Nb","name":"Nb","type":"box","color":"#7A4FD0","needle":"Nb","occ":0},{"id":"M","name":"M","type":"text","color":"#5B3FA8","needle":"M","occ":0}],"annotations":[{"id":"a1","type":"two","text":"\\# of nodes","pos":"above","labelBelow":false,"colorAuto":true,"color":"#000000","xshift":0,"yshift":1,"markIds":["p1","p2"]},{"id":"a2","type":"two","text":"\\# of graphs in $\\hat{\\mathcal{G}}_T$","pos":"below","labelBelow":false,"colorAuto":true,"color":"#000000","xshift":0.2,"yshift":-1,"markIds":["T1","T2"]},{"id":"a3","type":"two","text":"max.\\ indegree in $\\hat{\\mathcal{G}}_T$","pos":"below","labelBelow":false,"colorAuto":true,"color":"#000000","xshift":0,"yshift":-2.6,"markIds":["k1","k2"]},{"id":"a4","type":"one","text":"size of $\\mathcal{I}^*$","pos":"above-left","labelBelow":false,"colorAuto":true,"color":"#000000","xshift":0,"yshift":3,"markIds":["Is"]},{"id":"a5","type":"one","text":"\\# of samples per batch","pos":"above","labelBelow":false,"colorAuto":true,"color":"#000000","xshift":0,"yshift":1,"markIds":["Nb"]},{"id":"a6","type":"one","text":"\\# of samples for $\\mathbb{E}_y$","pos":"below","labelBelow":false,"colorAuto":true,"color":"#000000","xshift":0,"yshift":-1,"markIds":["M"]}]}
\mathcal{O}\big( (p\kappa^3)T + (p\kappa)(T^2|\mathcal{I}^*|N_bM) \big)
:::

归一化后接非线性变换 $g(\cdot)$，其中 $\mu$ 与 $\sigma$ 的含义如 [@eq:norm] 图例所示。

::: notes
强调 annotate 图例的 (i)(ii) 与公式着色一一对应；放映时点击引用可跳回。
:::
::::

# 实验 {#sec:exp}

## 定性对比

:::: slide layout="twoCol" title="排版效果对比" ratio="0.52"
::: col

三种工作流的排版耗时对比：

- PowerPoint 手动排版：约 35 分钟
- LaTeX 模板迁移：约 20 分钟
- 本方法（Markdown 直书）：约 5 分钟

左图为位图示例，右图为表格示例。
::: col

::: figure src="media/1.jpg" width="0.92" label="fig:arch" caption="系统架构与排版流程示意（位图）"
:::

::: table label="tab:perf" caption="图片格式与典型场景"
| 格式 | 类型 | 场景 |
| --- | --- | --- |
| JPG | 位图 | 照片 |
| SVG | 矢量 | 示意图 |
:::

::: notes
双栏页演示：左文右图表；放映时列表逐项出现（空格步进），PgDn 整页直翻。
:::
::::

:::: slide layout="content" title="矢量图与位图混排"

矢量图在任意缩放下保持清晰，适合架构图与曲线：

::: figure src="media/4.svg" width="0.55" label="fig:svg" caption="SVG 矢量图示例"
:::

PDF 与 EPS 矢量图同样受支持（经 pdf.js 与 Ghostscript 管线渲染）：

::: figure src="media/2.pdf" width="0.42" label="fig:pdf" caption="PDF 矢量图示例"
:::

::: notes
矢量图缩放不糊，适合架构图；位图照片建议提供高分辨率原文件。
:::
::::

:::: slide layout="content" title="高分辨率位图与 EPS"

::: figure src="media/3.png" width="0.4" label="fig:png" caption="高分辨率位图示例"
:::

EPS 矢量图经 Ghostscript 无损转换为矢量 PDF 后渲染：

::: figure src="media/5.eps" width="0.4" label="fig:eps" caption="EPS 矢量图示例"
:::

::: notes
EPS 需本机安装 Ghostscript；未安装时该图块会给出提示。
:::
::::

## 定量结果

:::: slide layout="twoCol" title="定量结果" ratio="0.52"
::: col

关键指标随训练轮次的变化如 [@fig:curve] 所示：

- 训练损失稳定收敛 {order=1}
- 排版合格率达 96.2% {order=2}
- 人工微调耗时下降 85% {order=3}

定量指标汇总见 [@tab:metrics]。
::: col

::: figure src="media/curve.png" width="0.95" label="fig:curve" caption="训练曲线（生成位图）"
:::

::: table label="tab:metrics" caption="定量指标对比"
| 指标 | 基线 | 本方法 |
| --- | --- | --- |
| 排版合格率 | 81.4% | 96.2% |
| 平均单页耗时 | 7 min | 1 min |
:::
::::

# 结论 {#sec:concl}

:::: slide layout="content" title="结论与展望"

本文提出了以 Markdown 为中心的学术幻灯片排版方法：

- 内容与版式分离，自动编号与目录生成 {order=1}
- 公式注释、三线表、矢量图等学术元素原生支持 {order=2}
- 放映模式集成激光笔、局部放大与演讲者视图 {order=3}

全部图表示例：[@fig:arch]、[@fig:svg]、[@fig:pdf]、[@fig:png]、[@fig:eps]、[@fig:curve]、[@tab:perf]、[@tab:metrics]。 {order=4}

::: notes
结尾 30 秒：重申「写 Markdown，剩下的交给软件」；预告 Q&A。
:::
::::

:::: end title="谢谢聆听 · 欢迎交流"
::::
