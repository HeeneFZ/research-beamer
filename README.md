<p align="center">
  <img src="icon.png" width="120" alt="Research Beamer" />
</p>

<h1 align="center">Research Beamer</h1>

<p align="center">以 Markdown 为中心的学术幻灯片排版工具 · 中英双语 · 4:3 / 16:9 · Windows 便携单文件</p>

---

## 理念：写内容，剩下的交给软件

写组会汇报时，我们长期在两个极端之间反复妥协：

- **PowerPoint** —— 元素手动排布繁琐，数学公式与文/式混排能力弱，模板迁移成本高；
- **LaTeX Beamer** —— 排版质量无可挑剔，但全部手写代码、学习曲线陡峭，改一处等编译。

Research Beamer 取两者的中点：**内容用 Markdown 直书，版式由排版引擎承担，微调在页面上可视化完成**。
它是「内容与版式分离」的刻意实践——你决定说什么、按什么顺序说；软件决定每个元素落在哪、多大、
什么字号，并保证任何比例、任何页数下都不溢出、不裁切。

设计上保持克制：不做自由画布、不做模板市场、不做用户系统。自由度是**有限但高效的**——
只暴露对学术页面真正有用的旋钮（块顺序、图宽、出现动画、双栏比例、页级字号、配色角色），
其余交给引擎，避免把用户变回手工排版员。

## 特性

### 自动排版，永不溢出

- 页面采用 **Beamer 物理尺寸**（16:9 = 160×90 mm，4:3 = 128×96 mm），字号以 **PPT 等效 pt 物理锚定**，
  导出 PDF 即最终观感；
- **宽度权威模型**：图像的显示宽度是你给的权威值；空间不足时引擎按「间距 → 字号 → 图高」的次序
  逐级挤压（字号下限 60%），图只在字距都到底后才让步；
- 排版由静默探测扫描器实测 DOM 溢出裁决，编辑画布、缩略胶片、放映窗、PDF 导出**四模式完全一致**；
- 六种版式：标题页 / 目录页 / 节分隔页 / 内容页 / 双栏页 / 结尾页，目录与页码全部自动生成。

### Markdown 存储，工程即文件夹

一个工程就是一个文件夹，可以被任何编辑器打开、被 Git 管理：

```
my-talk/
  deck.md     # front-matter（全部配置）+ 正文（:::: 页 / ::: 块围栏）
  media/      # 图片与视频（jpg/png/svg 直显，pdf 600DPI 矢量渲染，eps 经 Ghostscript 转矢量）
```

```yaml
# deck.md 头部 front-matter
---
beamerapp: 1
title: 基于深度学习的科技文本自动排版方法
authors: 张三^1; 李四^1,2
affiliations: 某某大学 计算机学院; 某某人工智能研究院
language: zh            # zh | en → 引用格式语言（式 (1) / Eq. (1)）
aspect: "16:9"          # "16:9" | "4:3"
numbering: continuous   # continuous | perSection
fontSize: 16            # 全局标准正文字号（PPT 等效 pt）
logo: media/高校logo.svg
palette:
  preset: academic-blue # 内置预设，或逐角色覆盖 base/deep 两档色
---
```

解析 / 序列化**往返幂等**：软件里的一切可视化编辑最终都落回这份 md，外部手改后重新打开即可。
自动保存（2 s 防抖）、全局快照撤销 / 重做、封面与结尾页支持浮动校徽（默认锚定色块右下角，
可拖动到任意位置、边缘手柄调宽）。

### 自动编号与引用跳转

节、公式、图、表统一 Pandoc 风格标签自动编号，正文用引用芯片引用：

```markdown
系统架构如 [@fig:arch] 所示，核心思想为 $$ \text{Deck} = \mathcal{C} \oplus \mathcal{R} \label{eq:deck} $$
其中 $\mathcal{C}$ 的含义见 [@eq:deck]，实验设置见第 [@sec:exp] 节、[@tab:perf]。
```

- 编辑器内键入 `@` 弹出全 deck 引用选择器（↑↓ / Enter 键盘导航）；
- **放映中点击引用芯片即跳转**至目标页并高亮，鼠标后退侧键 / Backspace / Alt+← **多级返回**原处；
- 导出 PDF 后引用保留为**可点击内链**。

### 单双栏与段式布局

页容器标注 `layout="twoCol"`（`ratio` 控制左栏宽），栏用 `::: col` 标记开启、`::: /col` 收回——
同一页内可多段交替，图文对照页一文一图，代码讲解页左码右注：

```markdown
:::: slide layout="twoCol" ratio="0.5" title="方法对比"
::: col
文字与列表放左栏……
::: col
::: figure src="media/arch.svg" width="1" caption="架构图"
:::
::::
```

### 公式注释（annotate-equations 风格）

两条路径，覆盖「逐项讲解」的学术场景：

- 行内注释：公式源内写 `\annotate[accent,box]{\mu}{均值：数据中心}` —— 渲染为着色高亮 + 公式下方同色图例；
- **注释公式块** `::: annoeq`：交互式引线标注——在编辑器里选中公式文字即可建标记（高亮框 / 文字着色 /
  隐形锚点），拖动标签调整位置，肘形引线与箭头按字号等比缩放；数据以 `%%anno {json}` 存于块首，
  实时矢量渲染，不生成图片文件；与普通公式共用编号序列、可被引用。

### 放映工具

`F5` 全屏放映（自动铺满副屏，主窗口切换为演讲者视图）：

| 操作 | 按键 |
|---|---|
| 步进动画 / 翻页 | → / 空格 / Enter（同序号同时出现）；PgDn 整页直翻 |
| 激光笔 | L 开关，C 循环换色 |
| 黑屏 / 白屏 | B / W |
| 透镜选区放大 | Z（1/4 页选框跟随鼠标，点击放大 2.2×）；Ctrl+滚轮 自由缩放；0 / Esc 复位 |
| 全页缩略墙 | G，点击直达 |
| 返回跳转原处 | 鼠标后退侧键 / Backspace / Alt+← |
| **放映录制** | 控件条 ⏺：60Hz 屏幕画面 + 系统声音 + 麦克风混音，webm 存工程根目录 |

演讲者视图提供：当前页 + 下一页预览 + 演讲稿（字号可调）+ 计时器 / 钟点 + 缩略条跳页，
以及**放映台快捷控制**（录制/停止、交换放映与监看屏幕，与放映窗控件条同源）；
放映页面左下角控件条悬停浮现，全部功能可点按。元素标注 `{order=N}` 即获得出现动画；
导出 PDF 恒为末态全显。双栏区在编辑画布与放映中以细灰线标注上下边界。

### 编辑效率

- 块工具栏 ⧉/📋：任意块复制 → 目标块后粘贴（自动剥除引用标签与自由定位，防冲突）；
- 双栏区三入口：块快捷工具栏、空页「＋ 添加内容」、文本块 "/" 斜杠菜单均可
  开始/结束双栏区（栏外块自动 disable 收栏项）；
- 撤销/重做快照持久化于工程目录 `.beamer-history.json`（隐藏文件），重开工程可继续撤销，
  深度上限 100 轮；
- 删光双栏区内全部内容时自动收回双栏（无需手动「结束双栏区」）。

### 其他

- 三线表可视化编辑（单元格直改、增删行列、题注与引用）；
- 图片：JPG / PNG / SVG / PDF（600 DPI 矢量）/ EPS（Ghostscript 无损转矢量）；视频 mp4 / webm
  （PDF 导出替换为首帧）；图片放大镜全屏无限缩放预览；
- KaTeX 公式（行内 `$..$` / 块级 `$$..$$`），LaTeX 编辑器带命令联想与实时预览；
  大标题 / 节 / 小节 / 页标题同样支持 `$..$` 行内公式与符号——键入 `$$` 即生成公式芯片，
  与正文行内公式同款交互，封面、节分隔页、目录、页眉四模式一致渲染；
- 微渐变学术主题，命名角色配色（primary / accent / emphasis，各 base / deep 两档）+ 内置预设；
  暗色模式；中英双语界面文案与引用格式。

## 快速开始

```bash
npm install
npm run build     # 构建渲染进程 (vite → dist/)
npm start         # 启动应用 (electron .)
```

- 首次启动自动载入中文示例工程（`examples/zh_talk`）；英文示例随软件一同分发，
  首次运行后位于用户数据目录 `%APPDATA%\beamerapp\examples\en_talk`，用「文件 → 打开工程…」选取；
- 开发监视：`npm run dev`（vite build --watch）+ `npm start`；
- 合约测试：`npm test`（vitest：md 往返 / 编号 / 引用解析 / 标注数据）。

### 打包

```bash
npm run pack      # → release/ResearchBeamer.exe（Windows 便携单文件）
```

国内网络需带镜像（Electron 分发与 winCodeSign 走 GitHub 直连会超时）：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run pack
```

EPS 矢量图需要本机安装 Ghostscript（默认查找 `C:\Program Files\gs`）。

## 目录结构

```
electron/     主进程 (main.cjs) + preload
src/
  model/      md 合约：parse/serialize、编号、行内语法、排版规格
  state/      zustand store + 撤销栈
  components/ 页面渲染、行内编辑器、公式/标注引擎、放映控件
  Present.tsx 放映窗口
scripts/      e2e 验证脚本（E2E_EVAL 注入渲染进程断言）
examples/     zh_talk / en_talk 示例工程（随 exe 打包）
```

## 已知限制

- 公式横向超宽时，AutoFit 压到字号下限仍可能裁剪（内容物理超载）；
- 撤销栈为 deck JSON 全量快照（上限 100 轮，持久化于 `.beamer-history.json`），数百页的超大工程撤销可能变慢；
- 放映窗口的多屏全屏行为依赖 Windows 显示器配置（单屏时全屏于当前屏）。

## 许可证

Apache License 2.0，详见 [LICENSE](LICENSE)。
