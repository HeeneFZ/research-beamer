// 整页渲染：六种版式（title / toc / section / content / twoCol / end）
// 用于编辑画布（含编辑态）、缩略胶片、放映窗口、PDF 导出。
//
// 排版：固定字阶（全 deck 统一，PPT 等效 pt 物理锚定）× 页级 fontScale（仅正文区）
// + 间距阶梯/图高预算（src/model/layoutSpec.ts，纯函数）；溢出兜底 = useLayoutScan
// 静默探测一次成型（间距→图高→字号下限 60%），结果存 store.pageLayout，
// 全模式（edit/thumb/present/print）一致；thumb 承担打开工程时的全页后台预算。
// 编辑态：段落/列表 TipTap；图/视频/公式/表点击开居中弹窗；块工具条在块外右上。
// 页眉：左=帧标题；右=节路径面包屑（点击段改名，悬停 ＋ 添加子节）。
//
// 拆分说明：本文件仅保留组装根（SlideMode/SlideViewProps 类型 + SlideView 主组件）；
// 各部件已移至 ./slide/*（types / useLayoutScan / FlowBlock /
// SectionBreadcrumb / StaticPages），纯搬移无行为变化。

import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Block, PAGE_SIZE, Slide } from '../model/types';
import { defaultAnnoState } from '../model/anno';
import { paletteVars } from '../model/palette';
import { computeLayoutSpec, defaultSpacing, layoutCssVars } from '../model/layoutSpec';
import { fileUrl } from './pdfRaster';
import { absMediaPath } from './paths';
import { InlineText } from './InlineText';
import { TitleEditor, FooterEditor, CoverFieldEditor, insertMediaBlock } from './BlockEditors';
import { useStore } from '../state/store';
import { SlideViewProps } from './slide/types';
import { useLayoutScan } from './slide/useLayoutScan';
import { buildSegments } from '../model/segments';
import { FlowBlock } from './slide/FlowBlock';
import { SectionBreadcrumb } from './slide/SectionBreadcrumb';
import { CoverLogo, LogoAddChip } from './slide/CoverLogo';
import { AuthorsLine, AffiliationsView, DividerView, TocView } from './slide/StaticPages';

export type { SlideMode, SlideViewProps } from './slide/types';
/** 空页首块菜单项（不含栏标记：空页直接开栏无意义，先有内容块再谈分栏） */
const FIRST_ITEMS = [
  { key: 'paragraph', badge: '¶', cls: 'sec', label: '段落', hint: '文本' },
  { key: 'itemize', badge: '≡', cls: 'eq', label: '列表', hint: '要点' },
  { key: 'equation', badge: '∑', cls: 'eq', label: '公式', hint: '编号' },
  { key: 'annoeq', badge: '⌖', cls: 'eq', label: '注释公式', hint: '引线标注' },
  { key: 'figure', badge: '▣', cls: 'fig', label: '图片…', hint: '文件' },
  { key: 'video', badge: '▶', cls: 'fig', label: '视频…', hint: '文件' },
  { key: 'table', badge: '▦', cls: 'tab', label: '表格', hint: '三线表' },
] as const;

export function SlideView({
  page, deck, computed, folder, mode = 'edit', revealed, onRef, onSlideJump, onZoom, highlightLabel,
}: SlideViewProps) {
  const { config } = deck;
  const size = PAGE_SIZE[config.aspect];
  const lang = config.language;
  const layout: string = page.kind === 'divider' ? 'section' : page.slide?.layout || 'content';

  const bodyRef = useRef<HTMLDivElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  // 空页首块类型菜单（portal 到 body 的浮层，存屏幕坐标；仅编辑画布需要）
  const [firstMenu, setFirstMenu] = useState<{ x: number; y: number } | null>(null);
  // 菜单打开期间：点击菜单外/Esc 关闭（portal 浮层通用关闭通道）
  useEffect(() => {
    if (!firstMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.add-first-menu, .add-first-btn')) return;
      setFirstMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFirstMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [firstMenu != null]);
  const slide0 = page.slide;
  const scannable = layout === 'content' || layout === 'twoCol' || layout === 'toc';
  // 排版规格：固定字阶（全 deck 统一）× 本页 fontScale（仅正文区）+ 间距两端 + 图高预算
  //（纯函数，全模式一致；封面/节页/结尾页为固定设计不参与）
  const spec = useMemo(() => {
    if (!scannable) return null;
    return computeLayoutSpec(
      { blocks: slide0?.blocks ?? [], fontScale: slide0?.fontScale, fontSize: config.fontSize },
    );
  }, [scannable, layout, slide0?.blocks, slide0?.fontScale, config.fontSize, config.aspect]);
  // 页级排版状态（store.pageLayout：扫描器静默探测写入，全模式统一读取——放映/PDF 与编辑画布一致）
  const fitKey = slide0 ? `${slide0.id}|${config.aspect}` : null;
  const layoutState = useStore((s) => (fitKey ? s.pageLayout[fitKey] : undefined));
  const style: CSSProperties = {
    width: `${size.w}mm`,
    height: `${size.h}mm`,
    ...paletteVars(config.palette),
    ...(spec ? (layoutCssVars(spec, layoutState ?? defaultSpacing(spec)) as unknown as CSSProperties) : {}),
  };
  // 重扫签名：块结构+文本量+字号配置（fontSize/fontScale 变化也须重算）；
  // 目录页内容来自节标题（块为空），节增删/改名并入签名。
  // 注意：表格单元格文本（cells）必须计入——否则表格编辑后不重扫，溢出不定稿
  const blockSig = slide0
    ? slide0.blocks.map((b) => b.id + (b.width != null ? `@${b.width}` : '')).join(',') + ':' + slide0.blocks.reduce(
        (n, b) => n + (b.text || '').length + (b.latex || '').length + (b.caption || '').length + (b.items?.join('').length ?? 0) + (b.cells ? b.cells.flat().join('').length : 0) + (b.anno ? JSON.stringify(b.anno).length : 0),
        0,
      ) + `|fs${config.fontSize}|sc${slide0.fontScale ?? 1}`
    : '';
  const tocSig = layout === 'toc'
    ? '|toc:' + deck.items.filter((it) => it.kind === 'section').map((it) => (it.kind === 'section' ? it.section.title : '')).join('|')
    : '';
  const editing = useStore((s) => s.editing);
  // 静默探测扫描：胶片缩略图恒运行（与画布同 mm 尺寸排版，打开工程即把全部页
  // 后台算完，进页即是终态）；画布扫描在本页无编辑时运行、present/print 只读 store。
  // 画布扫描在本页编辑期间让位：TipTap 编辑态行盒比静态渲染高 ~1.3px，画布/胶片
  // 两个扫描器对同一 key 交替提交不同终态（实测 fit 0.657↔0.6641 每 ~400ms 翻转，
  // 页脚近满页肉眼可见持续抽动）。胶片扫描器测的是静态 DOM——本来就是权威值，
  // 编辑期间只留它一个，退出编辑后画布扫描恢复并复核（相同值 no-op）。
  const editingThisSlide = mode === 'edit' && editing != null && editing.slideId === slide0?.id;
  useLayoutScan(bodyRef, slide0?.id, scannable && (mode === 'thumb' || (mode === 'edit' && !editingThisSlide)), config.aspect, blockSig + tocSig);

  const setEditing = useStore((s) => s.setEditing);

  const setConfig = useStore((s) => s.setConfig);

  const setLightbox = useStore((s) => s.setLightbox);
  const onZoomFig = (abs: string, ext: string, caption?: string) => setLightbox({ abs, ext, caption });
  const hl = (b: Block) => {
    if (highlightLabel == null || b.label == null) return false;
    // label 已归一化带前缀（eq:x），flash.label 是裸键（x）——按后缀匹配
    return b.label === highlightLabel || b.label.endsWith(':' + highlightLabel);
  };
  const flowProps = { deck, folder, computed, mode, revealed, onRef, onZoom: onZoom ?? onZoomFig };
  const renderFlow = (blocks: Block[]) => blocks.map((b) => (
    <FlowBlock key={b.id} block={b} slide={page.slide} {...flowProps} highlight={hl(b)} />
  ));

  const renderSegments = (blocks: Block[]) =>
    buildSegments(blocks).map((seg, i) => {
      if (seg.kind === 'full') return <div key={i} className="seg-full">{renderFlow(seg.blocks)}</div>;
      const colsStyle = { '--col-ratio': String(slide0?.ratio ?? 0.5) } as unknown as CSSProperties;
      return (
        <div key={i} className="cols" style={colsStyle}>
          <div className="col col-l">{renderFlow(seg.left)}</div>
          <div className="col col-r">{renderFlow(seg.right)}</div>
        </div>
      );
    });

  let body: JSX.Element;
  if (layout === 'title') {
    // 封面元素编辑态（点击即改 front-matter 字段；尾页标题复用 field='title'）
    const sl = page.slide;
    const ef = mode === 'edit' && sl && editing != null && editing.slideId === sl.id ? editing.field : undefined;
    // ef !== field：编辑另一封面字段时允许直接切换（延迟失焦关闭期间点开新字段）
    const startEdit = (field: 'coverTitle' | 'coverAuthors' | 'coverAff' | 'coverDate') =>
      mode === 'edit' && sl ? () => { if (ef !== field) setEditing({ slideId: sl.id, field }); } : undefined;
    const editCls = mode === 'edit' ? ' cv-edit' : '';
    body = (
      <>
        <div className="cover-stage">
          <div className="cover-card title-card">
            <h1 className={'cover-title' + editCls} onClick={startEdit('coverTitle')}>
              {ef === 'coverTitle'
                ? <CoverFieldEditor math value={config.title} onCommit={(v) => setConfig({ title: v || config.title })} />
                : <InlineText text={config.title} computed={computed} lang={lang} palette={config.palette} />}
            </h1>
            <div className="cover-bar" />
            <div className={'cover-authors' + editCls} onClick={startEdit('coverAuthors')}>
              {ef === 'coverAuthors'
                ? <CoverFieldEditor value={config.authors} onCommit={(v) => setConfig({ authors: v })} />
                : config.authors
                  ? <AuthorsLine authors={config.authors} lang={lang} />
                  : mode === 'edit' ? <span className="cover-affs-ph">＋ 作者（张三^1; 李四^2）</span> : null}
            </div>
            {/* 作者单位：作者行下方编号列出（序号对应 ^1 ^2 上标）；点击编辑（; 分隔多个） */}
            <div className={'cover-affs-wrap' + editCls} onClick={startEdit('coverAff')}>
              {ef === 'coverAff' ? (
                <CoverFieldEditor
                  value={config.affiliations}
                  placeholder="单位（多个用 ; 分隔，对应作者上标 1,2…）"
                  onCommit={(v) => setConfig({ affiliations: v })}
                />
              ) : (
                <AffiliationsView affiliations={config.affiliations} authors={config.authors} />
              )}
              {mode === 'edit' && !config.affiliations && ef !== 'coverAff' && (
                <span className="cover-affs-ph">＋ 点击填写单位</span>
              )}
            </div>
            <div className={'cover-date' + editCls} onClick={startEdit('coverDate')}>
              {ef === 'coverDate'
                ? <CoverFieldEditor value={config.date} onCommit={(v) => setConfig({ date: v })} />
                : config.date || (mode === 'edit' ? <span className="cover-affs-ph">＋ 日期</span> : null)}
            </div>
            {/* Logo：锚定态（无 logoPos）渲染在卡内右下角；浮动态在页面级（见下方）。
                未设置时编辑态显示「＋ Logo」占位 */}
            {config.logoPos == null && <CoverLogo config={config} folder={folder} mode={mode} />}
            {mode === 'edit' && !config.logo && <LogoAddChip />}
          </div>
        </div>
        {config.logoPos != null && <CoverLogo config={config} folder={folder} mode={mode} />}
      </>
    );
  } else if (layout === 'toc') {
    body = (
      <>
        <div className="s-header">
          <div className="s-title">{lang === 'zh' ? '目录' : 'Contents'}</div>
        </div>
        <div className="s-body toc-body" ref={bodyRef}><TocView deck={deck} computed={computed} onSlideJump={onSlideJump} /></div>
      </>
    );
  } else if (layout === 'section' && page.kind === 'divider') {
    // 节引用跳转：目标页是节分隔页，整卡高亮提示位置
    const secLabel = page.section?.label;
    const dividerHl = highlightLabel != null && secLabel != null &&
      (secLabel === highlightLabel || secLabel.endsWith(':' + highlightLabel));
    body = (
      <div className="cover-stage">
        <DividerView section={page.section!} deck={deck} computed={computed} highlight={dividerHl} />
      </div>
    );
  } else if (layout === 'end') {
    const sl = page.slide;
    const endEditing = mode === 'edit' && sl && editing != null && editing.slideId === sl.id && editing.field === 'title';
    const subEditing = mode === 'edit' && sl && editing != null && editing.slideId === sl.id && editing.field === 'coverSub';
    const t = sl?.title || (lang === 'zh' ? '谢谢聆听' : 'Thank You');
    body = (
      <>
        <div className="cover-stage">
          <div className="cover-card end-card">
            <h1
              className={'cover-title end-title' + (mode === 'edit' && sl ? ' cv-edit' : '')}
              onClick={mode === 'edit' && sl ? () => { if (!endEditing) setEditing({ slideId: sl.id, field: 'title' }); } : undefined}
            >
              {endEditing && sl ? <TitleEditor slide={sl} /> : <InlineText text={t} computed={computed} lang={lang} palette={config.palette} />}
            </h1>
            <div className="cover-bar center" />
            {/* 尾页副标题（front-matter shortTitle），点击可改 */}
            <div
              className={'cover-end-sub' + (mode === 'edit' && sl ? ' cv-edit' : '')}
              onClick={mode === 'edit' && sl ? () => { if (!subEditing) setEditing({ slideId: sl.id, field: 'coverSub' }); } : undefined}
            >
              {subEditing
                ? <CoverFieldEditor value={config.shortTitle} onCommit={(v) => setConfig({ shortTitle: v })} />
                : config.shortTitle || (mode === 'edit' ? <span className="cover-affs-ph">＋ 副标题</span> : null)}
            </div>
            {config.logoPos == null && <CoverLogo config={config} folder={folder} mode={mode} />}
            {mode === 'edit' && !config.logo && <LogoAddChip />}
          </div>
        </div>
        {config.logoPos != null && <CoverLogo config={config} folder={folder} mode={mode} />}
      </>
    );
  } else {
    const slide: Slide | undefined = page.slide;
    const blocks = slide?.blocks || [];
    const titleEditing = mode === 'edit' && slide && editing != null && editing.slideId === slide.id && editing.field === 'title';
    // 空态按可见内容判断：删光内容后残留的 colmark/colend 标记不算内容
    const hasContent = blocks.some((b) => b.type !== 'colmark' && b.type !== 'colend');
    const empty = mode === 'edit' && !hasContent;
    body = (
      <>
        <div className="s-header">
          <div className="s-title" onClick={() => { if (mode === 'edit' && slide && !titleEditing) setEditing({ slideId: slide.id, field: 'title' }); }}>
            {titleEditing && slide
              ? <TitleEditor slide={slide} />
              : slide?.title
                ? <InlineText text={slide.title} computed={computed} lang={lang} palette={config.palette} />
                : <span className="s-title-ph">{mode === 'edit' ? '点击输入标题' : ''}</span>}
          </div>
          {mode === 'edit' && slide
            ? <SectionBreadcrumb slide={slide} path={page.sectionPath} computed={computed} />
            : page.sectionPath.length > 0 && (
              <div className="s-sec">
                {page.sectionPath.map((s, i) => (
                  <span key={s.id} className="s-sec-crumb">
                    <span className="s-sec-num">{computed.sectionNum.get(s.id)}</span>
                    <span className={s.level === 1 ? 's-sec-l1' : 's-sec-sub'}><InlineText text={s.title} computed={computed} lang={lang} palette={config.palette} /></span>
                    {i < page.sectionPath.length - 1 && <span className="s-sec-sep">›</span>}
                  </span>
                ))}
              </div>
            )}
        </div>
        <div className="s-body" ref={bodyRef}>
          {renderSegments(blocks)}
          {empty && (
            <div className="add-first-wrap">
              <button
                ref={firstBtnRef}
                className="add-first-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  // 菜单 portal 到 body 定位：按钮 rect 是画布 transform 缩放后的
                  // 屏幕坐标，正合 fixed 定位之用（渲染在页面内会被 ~1.9× 画布
                  // 缩放放大成巨块——用户实测报障；与块工具栏菜单同一逃逸方案）
                  const r = e.currentTarget.getBoundingClientRect();
                  setFirstMenu((m) => (m ? null : {
                    x: Math.max(8, Math.min(r.left + r.width / 2 - 115, window.innerWidth - 246)),
                    y: Math.min(r.bottom + 6, window.innerHeight - 380),
                  }));
                }}
              >
                ＋ 添加内容
              </button>
              {firstMenu && createPortal(
                <div
                  className="btools-menu-float add-first-menu"
                  style={{ left: firstMenu.x, top: firstMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="ref-picker-title">选择首个内容块</div>
                  {FIRST_ITEMS.map((it) => (
                    <div
                      key={it.key}
                      className="ref-picker-item"
                      onMouseDown={(e) => { e.preventDefault(); if (!slide) return; setFirstMenu(null);
                        const s = useStore.getState();
                        // 清掉残留栏标记，回到干净单栏
                        for (const b of [...slide.blocks]) {
                          if (b.type === 'colmark' || b.type === 'colend') s.deleteBlock(slide.id, b.id);
                        }
                        if (it.key === 'figure' || it.key === 'video') {
                          void insertMediaBlock(slide.id, null, it.key);
                        } else {
                          const init =
                            it.key === 'equation' ? { latex: 'x = 1' } :
                            it.key === 'annoeq' ? { latex: 'x = 1', anno: defaultAnnoState() } :
                            it.key === 'itemize' ? { items: ['条目'] } :
                            it.key === 'table' ? { cells: [['列1', '列2'], ['', '']] } :
                            { text: '' };
                          const id = s.insertBlock(slide.id, null, it.key as Block['type'], init);
                          if (it.key === 'paragraph' || it.key === 'itemize') s.setFocus(id, 'start');
                          else s.setEditing({ slideId: slide.id, blockId: id });
                        }
                      }}
                    >
                      <span className={`ref-kind slash-badge-${it.cls}`}>{it.badge}</span>
                      <span>{it.label}</span>
                      <span className="slash-hint">{it.hint}</span>
                    </div>
                  ))}
                </div>,
                document.body,
              )}
            </div>
          )}
        </div>
        <div className="s-footer">
          {mode === 'edit' && slide && editing != null && editing.slideId === slide.id && editing.field === 'footer' ? (
            <FooterEditor slide={slide} />
          ) : (
            <span
              className={'s-foot-left' + (mode === 'edit' && slide ? ' s-foot-editable' : '') + (!slide?.footNote && mode === 'edit' && slide ? ' s-foot-ph' : '')}
              title={mode === 'edit' && slide ? '点击编辑本页页脚附加信息' : undefined}
              onClick={mode === 'edit' && slide ? (e) => { e.stopPropagation(); setEditing({ slideId: slide.id, field: 'footer' }); } : undefined}
            >
              {slide?.footNote || (mode === 'edit' && slide ? '＋ 页脚信息' : '')}
            </span>
          )}
          <span className="s-foot-mid" />
          <span className="s-foot-right">{page.no} / {computed.pages.length}</span>
        </div>
      </>
    );
  }

  return (
    <div
      id={mode === 'print' ? `page-${page.no}` : undefined}
      className={`sv mode-${mode}`}
      data-fen={config.fontEn}
      data-fzh={config.fontZh}
      style={style}
    >
      {body}
    </div>
  );
}
