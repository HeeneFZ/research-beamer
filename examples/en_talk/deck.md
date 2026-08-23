---
beamerapp: 1
title: "Progress Report: Deep Learning for Automatic Typesetting of Scientific Texts"
authors: Zhang San^1; Li Si^1,2
affiliations: School of Computer Science, Some University; Some Institute of Artificial Intelligence
date: August 19, 2026
shortTitle: DL Typesetting Progress
language: en
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

# Introduction {#sec:intro}

:::: slide layout="content" title="Background & Motivation"

Typesetting research documents still relies on heavy manual work. Two pain points dominate:

- **PowerPoint**: element-by-element manual layout; weak support for LaTeX math and mixed text-formula typesetting
- **LaTeX Beamer**: high output quality, but entirely hand-written code with a steep learning curve

A middle ground is a Markdown-centered [visual typesetting tool]{bg=emphasis}, following the route outlined in [@sec:method].

::: notes
Opening (1 min): start from the pain of writing weekly talk slides; introduce the "Markdown + visual fine-tuning" positioning.
:::
::::

:::: slide layout="content" title="Related Work"

Recent Markdown-based presentation tools each take a stance:

- Slidev / Marp: developer-friendly, but academic elements (booktabs tables, equation numbering) are limited
- Texslide: close to the LaTeX ecosystem, but offers no visual editing

Our goal: **keep the simplicity of Markdown**, [close the gap in academic typesetting]{color=accent}.

::: notes
One line on competitors; stress the middle ground: more academic than Slidev, easier than Beamer.
:::
::::

# Method {#sec:method}

## Architecture

:::: slide layout="content" title="System Architecture"

The system follows a three-layer, content/theme-separated architecture:

- **Content layer**: deck.md (Markdown contract) + media/ folder
- **Compute layer**: automatic numbering, TOC and page numbers
- **Render layer**: layout themes, presentation and export

The core idea is

::: equation label="eq:deck"
\text{Deck} = \mathcal{C}(\text{content}) \oplus \mathcal{R}(\text{theme})
:::

where $\mathcal{C}$ compiles content and $\mathcal{R}$ renders the theme, as shown in [@eq:deck].
::::

## Numbering & Cross-References

:::: slide layout="content" title="Equation Annotation & References"

Cross-references use Pandoc-style labels throughout: sections [@sec:intro], equations [@eq:deck], figures [@fig:arch], tables [@tab:perf].

Equations support annotate-style explanation:

::: equation label="eq:norm"
z = \frac{x - \mu}{\sigma}, \quad \annotate[accent]{\mu}{mean: data center}, \quad \annotate[primary,box]{\sigma}{std: dispersion}
:::

A nonlinearity $g(\cdot)$ follows (see the legend of [@eq:norm]).

::: notes
Stress that legend marks (i)(ii) correspond one-to-one to the colored terms; in presentation mode, clicking a reference jumps and the back button returns.
:::
::::

# Experiments {#sec:exp}

:::: slide layout="twoCol" title="Workflow Comparison" ratio="0.52"
::: col

Typesetting time of three workflows:

- PowerPoint, manual layout: ~35 min
- LaTeX template migration: ~20 min
- Ours (direct Markdown): ~5 min

The figure on the right shows a bitmap example.
::: col

::: figure src="media/1.jpg" width="0.96" label="fig:arch" caption="Architecture (bitmap)"
:::

::: table label="tab:perf" caption="Formats and uses"
| Format | Type | Use |
| --- | --- | --- |
| JPG/PNG | bitmap | photos |
| SVG/PDF/EPS | vector | diagrams |
:::

::: notes
Two-column demo: text left, figure/table right; items reveal stepwise with Space, PgDn skips the page.
:::
::::

:::: slide layout="content" title="Vector & Bitmap Figures"

Vector figures stay sharp at any zoom, ideal for diagrams and curves:

::: figure src="media/4.svg" width="0.48" label="fig:svg" caption="SVG vector"
:::

PDF and EPS figures are also supported:

::: figure src="media/2.pdf" width="0.42" label="fig:pdf" caption="PDF vector"
:::

::: notes
Vectors stay sharp at any zoom; supply high-resolution bitmaps for photos.
:::
::::

:::: slide layout="content" title="High-Resolution Bitmap & EPS"

::: figure src="media/3.png" width="0.34" label="fig:png" caption="Bitmap (PNG)"
:::

EPS figures are converted to vector PDF by Ghostscript:

::: figure src="media/5.eps" width="0.34" label="fig:eps" caption="EPS vector"
:::

::: notes
EPS needs a local Ghostscript install; otherwise the block shows a hint.
:::
::::

## Quantitative Results

:::: slide layout="twoCol" title="Quantitative Results" ratio="0.52"
::: col

Key metrics over training epochs (see [@fig:curve]):

- Training loss converges steadily {order=1}
- Acceptance rate reaches 96.2% {order=2}
- Manual touch-up time drops by 85% {order=3}

Aggregated metrics are listed in [@tab:metrics].
::: col

::: figure src="media/curve.png" width="0.9" label="fig:curve" caption="Training curves (generated bitmap)"
:::
::: /col

::: table label="tab:metrics" caption="Quantitative metrics"
| Metric | Baseline | Ours |
| --- | --- | --- |
| Acceptance rate | 81.4% | 96.2% |
| Avg. time per slide | 7 min | 1 min |
:::
::::

# Conclusion {#sec:concl}

:::: slide layout="content" title="Summary & Future Work"

This progress report presented a Markdown-centered typesetting approach for academic slides:

- Content/theme separation with automatic numbering and TOC generation {order=1}
- Native academic elements: equation annotation, booktabs tables, vector figures {order=2}
- Presentation mode with laser pointer, zoom, and presenter view {order=3}

All figure examples: [@fig:arch], [@fig:svg], [@fig:pdf], [@fig:png], [@fig:eps], [@fig:curve], [@tab:perf], [@tab:metrics]. {order=4}

::: notes
Closing (30 s): restate "write Markdown, let the software do the rest"; lead into Q&A.
:::
::::

:::: end title="Thanks · Questions Welcome"
::::
