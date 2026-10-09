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

import { CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Block, PAGE_SIZE, Slide } from '../model/types';
import { paletteVars } from '../model/palette';
import { slideFontStack } from '../model/fonts';
import { computeLayoutSpec, defaultSpacing, layoutCssVars } from '../model/layoutSpec';
import { InlineText } from './InlineText';
import { TitleEditor, FooterEditor, CoverFieldEditor } from './BlockEditors';
import { useStore } from '../state/store';
import { SlideViewProps } from './slide/types';
import { useLayoutScan } from './slide/useLayoutScan';
import { pageMediaReady, useMediaReady } from './slide/useMediaReady';
import { useTitleAlignment } from './slide/useTitleAlignment';
import { buildSegments } from '../model/segments';
import { FlowBlock } from './slide/FlowBlock';
import { SectionBreadcrumb } from './slide/SectionBreadcrumb';
import { CoverLogo, LogoAddChip } from './slide/CoverLogo';
import { AuthorsLine, AffiliationsView, DividerView, TocView } from './slide/StaticPages';

import { INSERT_ITEMS, insertBlockByKey } from './insertItems';

const referenceSignatures = new WeakMap<SlideViewProps['computed']['labelPageIndex'], string>();
export function referenceSignature(computed: SlideViewProps['computed']): string {
  let signature = referenceSignatures.get(computed.labelPageIndex);
  if (signature == null) {
    signature = JSON.stringify([
      [...computed.sectionNumByLabel], [...computed.equationNum], [...computed.equationNumByLabel],
      [...computed.figureNum], [...computed.figureNumByLabel], [...computed.tableNum], [...computed.tableNumByLabel],
      [...computed.labelPageIndex], [...computed.sectionPageIndex],
    ]);
    referenceSignatures.set(computed.labelPageIndex, signature);
  }
  return signature;
}

export const SlideView = memo(function SlideView({
  page, deck, computed, folder, mode = 'edit', layoutAuthority = false, layoutSnapshot, mediaSnapshot, resourceSnapshot, revealed, onRef, onSlideJump, onZoom, highlightLabel, onReady, mediaActive,
}: SlideViewProps) {
  const { config } = deck;
  const size = PAGE_SIZE[config.aspect];
  const lang = config.language;
  const layout: string = page.kind === 'divider' ? 'section' : page.slide?.layout || 'content';

  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 空页首块类型菜单（portal 到 body 的浮层，存屏幕坐标；仅编辑画布需要）
  const [firstMenu, setFirstMenu] = useState<{ x: number; y: number } | null>(null);
  const activeEditor = useStore((s) => mode === 'edit' && !s.presenting && s.computed.pages[s.current]?.slide?.id === page.slide?.id);
  useEffect(() => { if (!activeEditor) setFirstMenu(null); }, [activeEditor]);
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
  const layoutState = useStore((s) => (fitKey ? (layoutSnapshot ?? s.pageLayout)[fitKey] : undefined));
  const mediaRevision = useStore((s) => mediaSnapshot ?? s.mediaRevision);
  const style: CSSProperties = {
    width: `${size.w}mm`,
    height: `${size.h}mm`,
    fontFamily: slideFontStack(config.fontEn, config.fontZh),
    ...paletteVars(config.palette),
    ...(spec ? (layoutCssVars(spec, layoutState ?? defaultSpacing(spec)) as unknown as CSSProperties) : {}),
  };
  // 精确内容签名：等字数替换、字体/双栏比例/素材变化同样会影响真实 DOM 高度。
  // 结构共享让未修改页复用序列化结果；引用编号指纹全 deck 只计算一次。
  const blockSig = useMemo(() => JSON.stringify({
    blocks: slide0?.blocks.map(({ order, itemOrders, ...geometry }) => geometry),
    fontScale: slide0?.fontScale, ratio: slide0?.ratio, layout, folder, fontSize: config.fontSize,
    fontZh: config.fontZh, fontEn: config.fontEn, language: config.language, palette: config.palette,
  }), [slide0, layout, folder, config.fontSize, config.fontZh, config.fontEn, config.language, config.palette]);
  const tocSig = layout === 'toc'
    ? '|toc:' + deck.items.filter((it) => it.kind === 'section').map((it) => (it.kind === 'section' ? it.section.title : '')).join('|')
    : '';
  const editing = useStore((s) => activeEditor && s.editing?.slideId === slide0?.id ? s.editing : null);
  // All visible modes consume the finalized static thumbnail layout.
  const editingThisSlide = mode === 'edit' && editing != null && editing.slideId === slide0?.id;
  const layoutSignature = blockSig + tocSig + referenceSignature(computed) + `|media:${mediaRevision}`;
  const layoutReady = !scannable || layoutState?.signature === layoutSignature;
  const mediaReady = useMediaReady(rootRef, mode !== 'thumb', layoutSignature);
  useLayoutScan(bodyRef, fitKey, scannable && layoutAuthority, layoutSignature, spec);
  useTitleAlignment(rootRef, `${config.fontEn}|${config.fontZh}|${config.fontSize}|${config.aspect}|${slide0?.title}|${page.sectionPath.map((section) => section.title).join('|')}|${lang}|${mode}|${editing?.field ?? ''}`);
  useLayoutEffect(() => {
    // Inherited label fonts may change while the KaTeX equation keeps its width.
    // Refresh annotation geometry from the same finalized layout in every view.
    rootRef.current?.querySelectorAll('.ae-wrap').forEach((wrap) => wrap.dispatchEvent(new Event('layoutprobe')));
  }, [layoutSignature, layoutState]);
  useLayoutEffect(() => { onReady?.(layoutReady && mediaReady && !!rootRef.current && pageMediaReady(rootRef.current)); }, [layoutReady, mediaReady, layoutSignature, page, config, computed, onReady]);

  const setEditing = useStore((s) => s.setEditing);

  const setConfig = useStore((s) => s.setConfig);

  const setLightbox = useStore((s) => s.setLightbox);
  const onZoomFig = useCallback((abs: string, ext: string, caption?: string) => setLightbox({ abs, ext, caption }), [setLightbox]);
  const hl = (b: Block) => {
    if (highlightLabel == null || b.label == null) return false;
    // label 已归一化带前缀（eq:x），flash.label 是裸键（x）——按后缀匹配
    return b.label === highlightLabel || b.label.endsWith(':' + highlightLabel);
  };
  const flowProps = { deck, folder, computed, mode, revealed, onRef, resourceSnapshot, onZoom: onZoom ?? onZoomFig };
  const renderFlow = (blocks: Block[]) => blocks.map((b) => (
    <FlowBlock key={b.id} block={b} slide={page.slide} {...flowProps} highlight={hl(b)} mediaActive={b.type === 'figure' || b.type === 'video' ? mediaActive : undefined} />
  ));

  const renderSegments = (blocks: Block[]) => {
    const segments = buildSegments(blocks);
    const visibleSegments = segments.filter((segment) => segment.kind === 'cols'
      || segment.blocks.some((block) => block.type !== 'paragraph' || !!block.text?.trim()));
    const mixedColumns = visibleSegments.length > 1;
    return segments.map((seg, i) => {
      if (seg.kind === 'full') return <div key={i} className="seg-full">{renderFlow(seg.blocks)}</div>;
      const colsStyle = { '--col-ratio': String(slide0?.ratio ?? 0.5) } as unknown as CSSProperties;
      return (
        <div key={i} className={'cols' + (mixedColumns ? ' cols-boundary' : '')} style={colsStyle}>
          <div className="col col-l">{renderFlow(seg.left)}</div>
          <div className="col col-r">{renderFlow(seg.right)}</div>
        </div>
      );
    });
  };

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
            <h1 data-cover-field="coverTitle" className={'cover-title' + editCls} onClick={startEdit('coverTitle')}>
              {ef === 'coverTitle'
                ? <CoverFieldEditor slideId={sl!.id} math value={config.title} label="汇报标题" preview={<InlineText text={config.title} computed={computed} lang={lang} palette={config.palette} />} onCommit={(v) => setConfig({ title: v || config.title })} />
                : <InlineText text={config.title} computed={computed} lang={lang} palette={config.palette} />}
            </h1>
            <div className="cover-bar" />
            <div data-cover-field="coverAuthors" className={'cover-authors' + editCls} onClick={startEdit('coverAuthors')}>
              {ef === 'coverAuthors'
                ? <CoverFieldEditor slideId={sl!.id} value={config.authors} label="作者与上标" preview={config.authors ? <AuthorsLine authors={config.authors} lang={lang} /> : <span className="cover-affs-ph">＋ 作者（张三^1; 李四^2）</span>} onCommit={(v) => setConfig({ authors: v })} />
                : config.authors
                  ? <AuthorsLine authors={config.authors} lang={lang} />
                  : mode === 'edit' ? <span className="cover-affs-ph">＋ 作者（张三^1; 李四^2）</span> : null}
            </div>
            {/* 作者单位：作者行下方编号列出（序号对应 ^1 ^2 上标）；点击编辑（; 分隔多个） */}
            <div data-cover-field="coverAff" className={'cover-affs-wrap' + editCls} onClick={startEdit('coverAff')}>
              {ef === 'coverAff' ? (
                <CoverFieldEditor
                  slideId={sl!.id}
                  value={config.affiliations}
                  label="作者单位"
                  preview={config.affiliations ? <AffiliationsView affiliations={config.affiliations} authors={config.authors} /> : <span className="cover-affs-ph">＋ 点击填写单位</span>}
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
            <div data-cover-field="coverDate" className={'cover-date' + editCls} onClick={startEdit('coverDate')}>
              {ef === 'coverDate'
                ? <CoverFieldEditor slideId={sl!.id} value={config.date} label="日期" preview={config.date || <span className="cover-affs-ph">＋ 日期</span>} onCommit={(v) => setConfig({ date: v })} />
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
          <div className="s-title"><div className="s-title-content">{lang === 'zh' ? '目录' : 'Contents'}</div></div>
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
              data-cover-field="title"
              className={'cover-title end-title' + (mode === 'edit' && sl ? ' cv-edit' : '')}
              onClick={mode === 'edit' && sl ? () => { if (!endEditing) setEditing({ slideId: sl.id, field: 'title' }); } : undefined}
            >
              {endEditing && sl ? <CoverFieldEditor slideId={sl.id} math value={t} rawValue={sl.title || ''} label="结尾页标题"
                preview={<InlineText text={t} computed={computed} lang={lang} palette={config.palette} />}
                onCommit={(value) => useStore.getState().updateSlide(sl.id, { title: value || undefined })} /> : <InlineText text={t} computed={computed} lang={lang} palette={config.palette} />}
            </h1>
            <div className="cover-bar center" />
            {/* 尾页副标题（front-matter shortTitle），点击可改 */}
            <div
              data-cover-field="coverSub"
              className={'cover-end-sub' + (mode === 'edit' && sl ? ' cv-edit' : '')}
              onClick={mode === 'edit' && sl ? () => { if (!subEditing) setEditing({ slideId: sl.id, field: 'coverSub' }); } : undefined}
            >
              {subEditing
                ? <CoverFieldEditor slideId={sl!.id} value={config.shortTitle} label="结尾页副标题" preview={config.shortTitle || <span className="cover-affs-ph">＋ 副标题</span>} onCommit={(v) => setConfig({ shortTitle: v })} />
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
            <div className="s-title-content">
            {titleEditing && slide
              ? <TitleEditor slide={slide} />
              : slide?.title
                ? <InlineText text={slide.title} computed={computed} lang={lang} palette={config.palette} />
                : <span className="s-title-ph">{mode === 'edit' ? '点击输入标题' : ''}</span>}
            </div>
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
              {activeEditor && firstMenu && createPortal(
                <div
                  className="btools-menu-float add-first-menu"
                  style={{ left: firstMenu.x, top: firstMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="ref-picker-title">选择首个内容块</div>
                  {INSERT_ITEMS.map((it) => {
                    // 空页无栏区可收：收栏项 disable（与块工具栏同款口径，入口可见）
                    const dis = it.key === 'colend';
                    return (
                      <div
                        key={it.key}
                        className={'ref-picker-item' + (dis ? ' disabled' : '')}
                        title={dis ? '空页没有双栏区可结束' : undefined}
                        onMouseDown={(e) => { e.preventDefault(); if (!slide || dis) return; setFirstMenu(null);
                          // 清掉残留栏标记，回到干净单栏
                          const s = useStore.getState();
                          for (const b of [...slide.blocks]) {
                            if (b.type === 'colmark' || b.type === 'colend') s.deleteBlock(slide.id, b.id);
                          }
                          insertBlockByKey(slide.id, null, it.key);
                        }}
                      >
                        <span className={`ref-kind slash-badge-${it.cls}`}>{it.badge}</span>
                        <span>{it.label}</span>
                        <span className="slash-hint">{it.hint}</span>
                      </div>
                    );
                  })}
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
      ref={rootRef}
      id={mode === 'print' ? `page-${page.no}` : undefined}
      className={`sv mode-${mode}`}
      data-page-index={page.index}
      data-page-width={size.w * 96 / 25.4}
      data-fen={config.fontEn}
      data-fzh={config.fontZh}
      data-layout-ready={layoutReady}
      data-slide-ready={layoutReady && mediaReady}
      data-media-wait={!mediaReady && !onReady ? '' : undefined}
      data-layout-wait={!layoutReady && !(editingThisSlide && layoutState) ? '' : undefined}
      style={style}
    >
      {body}
    </div>
  );
});
