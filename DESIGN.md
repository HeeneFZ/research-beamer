# Design

## Source of truth
- Status: Active — 学术汇报优先；原版章节页结合 A 的轻微通透质感。
- Last refreshed: 2026-10-08。
- Primary product surfaces: Markdown 编辑画布、缩略图、放映、PDF 导出。
- Evidence reviewed: README.md、docs/REQUIREMENTS.md、docs/DECISIONS.md、src/styles.css、src/components/slide/StaticPages.tsx、src/components/SlideView.tsx。

## Brand
- Personality: 克制、清晰的学术汇报工具；章节页增加通透的毛玻璃质感。
- Trust signals: 数学公式清晰、编号一致、文件可直接编辑。
- Avoid: 大面积柔光、极光色、巨型圆角、胶囊装饰、低对比正文；章节数字必须与卡片错开。

## Product goals
- Goals: 章节过渡更精致，标题与小节一眼可读。
- Non-goals: 模板市场、自由画布和新的主题系统。
- Success signals: 白底与原版主题色卡片保持克制；数字完整可见，四种显示模式一致。

## Personas and jobs
- Primary personas: 科研人员、研究生。
- User jobs: 准备组会、学术报告，快速建立章节结构。
- Key contexts of use: 电脑编辑、投影放映、分享 PDF。

## Information architecture
- Primary navigation: 原有胶片大纲与引用跳转。
- Core routes/screens: 章节分隔页，保持原有章节和小节关系。
- Content hierarchy: 部分编号 → 章节标题 → 小节列表。

## Design principles
- 阅读优先，玻璃效果只承担层次与章节过渡。
- 复用现有配色角色、DividerView 与容器单位。
- Tradeoffs: 仅用轻微半透明色层、细边框和浅阴影表达磨砂质感；不增加背景柔光或滤镜开销。

## Visual language
- Color: 保留白底和现有 primary/base/deep 章节卡片，白色文字保证学术投影可读。
- Typography: 沿用中文/西文字体设置，标题、编号、小节建立清晰字阶。
- Spacing/layout rhythm: 保留原版两栏与字号；顶部为章节数字预留独立空间，卡片保持居中。
- Shape/radius/elevation: 保留原版小圆角；细边框和单层浅阴影。
- Motion: 无常驻动画。
- Imagery/iconography: 只保留完整可见的章节数字，不增加图案或位图背景。

## Components
- Existing components to reuse: DividerView、InlineText、SlideView。
- New/changed components: 仅章节页容器与样式；封面、结尾页不受影响。
- Variants and states: 有/无小节、长标题、中文/英文、引用高亮。
- Token/component ownership: src/styles.css 与现有 paletteVars。

## Accessibility
- Target standard: 沿用现有应用交互约定。
- Keyboard/focus behavior: 保留原有导航和引用行为。
- Contrast/readability: 不让玻璃纹理穿过标题和小节文字的阅读区。
- Screen-reader semantics: 保留标题与小节的现有语义结构。
- Reduced motion and sensory considerations: 无新增动画、闪烁或动态粒子。

## Responsive behavior
- Supported breakpoints/devices: Electron 桌面；16:9 与 4:3。
- Layout adaptations: 使用 cqw/cqh，保留小节数量对应的字号收缩。
- Touch/hover differences: 不添加新的悬停入口。

## Interaction states
- Loading / empty: 沿用章节自动生成行为；无小节时保持标题布局。
- Error / success / disabled: 不引入新状态流程。
- Offline/slow network: CSS 效果完全离线。

## Content voice
- Tone: 学术、直接。
- Terminology: 中文“第 N 部分”，英文“Part N”。
- Microcopy rules: 不增加装饰性说明文案。

## Implementation constraints
- Framework/styling system: React、现有 CSS 与 KaTeX。
- Design-token constraints: 复用命名配色角色，不增加依赖。
- Performance constraints: 使用静态 CSS 色层，无 backdrop-filter、全屏滤镜、常驻动画或位图资源。
- Compatibility constraints: 长标题、行内公式、中英文、两种比例、放映与 PDF 可读。
- Screenshot expectations: 真实渲染修改后的章节页；验证两种比例、中文/英文及多位章节数字均不与卡片重叠。

## Open questions
- 无待定方向；后续微调以克制的学术汇报风格为准。
