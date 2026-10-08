---
name: research-beamer-deck
description: Read, explain and edit Research Beamer academic presentation projects stored as deck.md plus media/. Use for this application's custom Markdown slide containers, chapter hierarchy, equations, annotations, references and animation order.
---

# Research Beamer 工程读写

这是 Research Beamer 的工程格式说明与读写 Skill。工程使用 UTF-8 Markdown 和 YAML 保存内容，而不是 PPTX。普通 Markdown 阅读器会把冒号容器当成文本；理解汇报时须先识别本文定义的页面、块和章节。

## 工程入口与阅读顺序

```text
工程目录/
  deck.md                  唯一的汇报内容与配置入口
  media/                   相对路径引用的图片、矢量图、视频
  SKILL.md                 本说明，由应用保存工程时补充
  .beamer-history.json      可选的撤销历史，不是当前汇报内容
```

先读取 `deck.md` 的 YAML 前言，再按正文顺序识别章节与页容器，最后解析每页的内容块。需描述图像时，定位其 `src` 指向的素材；仅根据题注无法确定图中全部内容。历史、录制视频和未引用的素材不应被误认为当前幻灯片。

修改以 `deck.md` 和明确需要修改的素材为准。应用打开时生成的内部 slide/block/section ID 不写入 Markdown，不要自行添加 ID 属性。标注 JSON 内的 mark/annotation ID 会落盘，须保留其对应关系。

## YAML 前言

文件开头的两行 `---` 之间是 YAML。例如：

```yaml
---
beamerapp: 1
title: "级联系统中的 $g(x)$"
authors: "张三^1,2; 李四^2"
affiliations: "第一单位; 第二单位"
date: "2026-10-08"
shortTitle: "讨论与展望"
language: zh
aspect: "16:9"
numbering: perSection
fontZh: sans
fontEn: sans
fontSize: 16
sectionPages: true
logo: "media/logo.svg"
logoPos: null
palette:
  preset: academic-blue
---
```

| 字段 | 含义 |
| --- | --- |
| `beamerapp` | 格式版本，当前为 1 |
| `title` | 封面标题，支持 `$…$` 行内公式、粗体和着色；YAML 多行字符串可保存标题硬换行 |
| `authors` | 作者以 `;` 分隔；末尾 `^1` 或 `^1,2` 为单位上标 |
| `affiliations` | 单位以 `;` 分隔，对应作者上标序号 |
| `date` | 封面日期 |
| `shortTitle` | 结尾页副标题 |
| `language` | `zh` 或 `en`，控制本地化文案 |
| `aspect` | `16:9` 或 `4:3`，分别为 160×90 mm、128×96 mm |
| `numbering` | `continuous` 连续编号，`perSection` 按一级章节编号 |
| `fontZh` / `fontEn` | `serif` 或 `sans`，中文和英文分别选择；数学仍用 KaTeX 字体 |
| `fontSize` | PPT 等效字号，10–40；应用会根据内容进行页级压缩 |
| `sectionPages` | 是否自动生成一级章节封面，不改变章节归属 |
| `logo` | 可选相对路径 |
| `logoPos` | 可选 `"x,y,w"`，以页面百分比指定浮动 Logo；空值使用卡片内锚点 |
| `palette` | 预设或显式主题色配置 |

完整配色可指定 `primary`、`accent`、`emphasis` 的 `{base, deep}`，以及 `text`、`textMuted`、`bg`、`bgAlt`。若只需沿用配色，保留原值，不必重写颜色。

## 章节与页面是两个层次

页容器外的标题定义章节：

```markdown
# 建模过程 {#sec:model}
## 基本假设 {#sec:assumptions}
```

界面新建只提供章节与小节两级。旧文件的 `###` 三级章节仍可读取、编号和重命名。章节编号由顺序生成，不在标题里手工写 `1.2`。

归属是**顺序性的**：页属于它之前最近的章节路径；`##` 一直有效到下一个同级或更高级标题。一级章节开始时清除此前的小节，一级章节结束于下一个 `#`。不要把这些结构标题写到某页容器内部。

当 `sectionPages: true` 时，一级章节封面由应用自动生成，不需增加一张伪造的内容页。关闭封面只隐藏这类自动页，章节、小节及引用仍然存在。

移动内容页会改变其前置章节上下文。要把页变成某章的直属页，放在该 `#` 后、首个 `##` 前。已有小节的章末仍属于最后一个小节。整章移动须连同下属小节和内容页一起移动；独立的汇报封面、目录、结尾页保留其独立位置。

## 页容器：四个冒号

```markdown
:::: title
::::

:::: toc
::::

:::: slide layout="content" title="基本模型" fontScale="1" foot="课题组学术汇报"
这里是第一页正文。
::::

:::: end title="谢谢聆听"
::::
```

`::::` 是页面闭合；`::: ` 是块标记。编写时固定使用四个和三个冒号，避免混用。页面之间的空行不创建新页。

| 页面形式 | 用途 |
| --- | --- |
| `:::: title` | 封面，内容来自 YAML 的标题、作者、单位、日期、Logo |
| `:::: toc` | 自动目录 |
| `:::: slide layout="content"` | 流式内容页，可以包含双栏段 |
| `:::: slide layout="twoCol"` | 双栏页，仍须用栏标记定义左右内容 |
| `:::: end` | 结尾页；无显式标题时使用当前语言默认文案，副标题取 `shortTitle` |

页属性只解析 `key="value"` 的双引号形式。`title` 支持行内语法；`ratio` 为左栏比例，须满足 `0.1 < ratio < 0.9`；`fontScale` 为正文比例，范围 0.6–1.5，不改变页眉；`foot` 为本页页脚。属性内的 `"` 和 `\` 需要反斜杠转义；页属性和章节标题保持单行。YAML 字符串的转义规则与页属性不同，不可混用。

## 正文、列表与行内表达

空行分隔段落。段落中普通源码折行会合并；若要保留块内换行，在非末行行尾写一个反斜杠，下一行继续同一段。行尾已有字面反斜杠时需成对转义，应用序列化会处理这一细节。

```markdown
讨论参数 $\alpha$，参见[@eq:model]。

- 第一项
- 第二项含 $x_i$ {order=2}
{order=1}
```

列表项以 `- ` 开头，每项一行；项尾的 `{order=N}` 是该项动画顺序，列表下独立的 `{order=N}` 是整个列表块顺序。列表项内硬换行在保存时会转换为空格。

支持以下行内表达，可嵌套着色、粗体、公式：

- `$…$`：LaTeX 行内公式，例如 `$x_i^2$`。
- `**粗体**`、`*斜体*`。
- `[强调文字]{color=accent}`、`[文字]{color=primary}`、`[文字]{color=emphasis}`。
- `[背景文字]{bg=accent}`。
- `[@eq:model]`、`[@fig:result]`、`[@tab:data]`、`[@sec:model]`：交叉引用。

引用标签应使用英文、数字、下划线或连字符，完整标签在工程中唯一。不要把自动显示的“式(1.2)”写死成普通文本代替引用。

## 公式与标注公式

独立公式可以这样写：

```markdown
::: equation label="eq:model" order="2"
\boldsymbol{y}=\boldsymbol{A}\boldsymbol{x}
:::
```

也支持 `$$` 公式块，内部 `\label{model}` 会被提取为 `eq:model`。LaTeX 体不是 HTML；不要把 `\`、`<`、下标等变成聊天转义或 HTML 实体。公式编号由应用生成。

简短说明可使用 `\annotate[accent]{\mu}{参数含义}`；`accent,box` 增加高亮框。需要多个标注点和引线时使用 `annoeq`：

```markdown
::: annoeq label="eq:energy"
%%anno {"fontSize":30,"scale":1.5,"shade":17,"equalHeight":true,"fboxScale":0.5,"annFontScale":0.5,"labelFont":"auto","paletteIdx":0,"marks":[{"id":"m1","name":"energy","type":"box","color":"#2A4FC7","needle":"E","occ":0}],"annotations":[{"id":"a1","type":"one","text":"能量","pos":"above","labelBelow":false,"colorAuto":true,"color":"#2A4FC7","xshift":0,"yshift":0,"markIds":["m1"]}]}
E=mc^2
:::
```

`%%anno` 之后为单行 JSON，后面是 LaTeX 正文。`marks` 的 `needle` 指向**渲染后可见文字**，`occ` 为从 0 起的出现次数。`annotations.markIds` 引用标注点 ID，不是交叉引用标签。改公式时检查锚定文字是否仍存在；不要随意更换 mark ID 或留下断开的 markIds。

标注参数：`scale` 是幻灯片公式比例（0.5–2）；`fontSize` 是编辑预览基准字号；`annFontScale` 是说明文字相对公式字号；`xshift` 以 ex 为单位，`yshift` 以 em 为单位。标记类型为 `box`、`text`、`plain`；引线类型为 `one`、`two`。位置为 `above`、`below`、`above-left`、`below-left`。`labelFont` 为 `auto`、`serif`、`sans`。

## 图、视频、表

```markdown
::: figure src="media/result.pdf" width="0.75" label="fig:result" caption="实验结果" order="3"
:::

::: video src="media/demo.mp4" width="0.6" autoplay="false"
:::

::: table label="tab:data" caption="参数设置"
| 参数 | 数值 |
| --- | --- |
| $n$ | 10 |
:::
```

`src` 通常相对于工程目录；保持 `media/` 文件对应关系，不要只改路径字符串却遗漏素材。`width` 是可用正文/栏宽的比例，须满足 `0 < width <= 1`，省略时使用自动宽度。图支持 PNG/JPEG/GIF/SVG/PDF/EPS；GIF 在放映中保留动画；EPS 需要 Ghostscript。视频通常为 MP4/WebM。

图、表支持 `caption` 和 `label`，视频没有图表交叉引用。表格首行为表头，第二行是分隔线；单元格中的 `|` 写成 `\|`，字面反斜杠写成 `\\`。

`pos="x,y,w"` 是旧格式中的可选位置元数据；理解时保留，不用它代替当前流式栏结构。

## 单栏与双栏段

```markdown
:::: slide layout="content" title="模型与结果" ratio="0.5"
全宽引言。

::: col
左栏内容。

::: col
右栏内容。

::: /col
恢复全宽的总结。
::::
```

第一个 `::: col` 开始左栏，第二个切入右栏；`::: /col` 结束整个栏区。它们是独立标记，**不再配一个 `:::` 闭合行**。页尾也会结束栏区。第三个 `::: col` 会开始下一组栏区，不是第三栏。

整页双栏可从第一个栏标记开始，并省略末尾收栏。混合单栏与双栏时，应用会显示轻微的栏区边界提示；纯双栏页不会增加这些线。空栏占位由应用补齐，不要为了占位写无意义文字。

## 演讲稿与动画

```markdown
::: notes
这一页强调三个前提，随后展示结果。
:::
```

`notes` 属于当前页，不在幻灯片上显示，放映时出现在监看视图。

块属性 `order="N"` 或段落尾 `{order=N}` 从 1 起。没有 order 的内容始终显示；相同 N 的内容同时出现。实际步进按唯一顺序值升序，不要求连续。界面上的 `*4`、秒表和手柄是编辑控件，不写入汇报正文。

## 读写检查

解释工程时按“配置 → 章节路径 → 页 → 块 → 素材/引用/标注”组织结果。编辑后检查：页面与块闭合、双栏标记顺序、素材路径、引用唯一性、标注锚点对应、动画语义。优先局部修改，不随意重排章节、规范化整个 YAML 或删除未理解的兼容元数据。

排版压缩结果、预备图像和显示器 DPI 不属于 Markdown 内容，不要把它们写回 deck.md。需要重现应用最终布局时，打开该工程或从应用导出 PDF，而不是假设普通 Markdown 的默认字体和换行就是幻灯片观感。
