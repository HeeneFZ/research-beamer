// 单个流式块：编辑态/展示态分发 + 块点击进编辑 + BlockToolbar 挂载

import { CSSProperties, memo, useEffect, useState } from 'react';
import { Block, Deck, Slide } from '../../model/types';
import { Computed, genericRefText } from '../../model/numbering';
import { InlineText } from '../InlineText';
import { FigureView, VideoView } from '../FigureView';
import { TableView } from '../TableView';
import { EquationView } from '../SlideViewEquation';
import { AnnoEquationView } from '../AnnoEquationView';
import {
  EquationEditor, MediaPanel, TableEditor,
} from '../BlockEditors';
import { AnnoEqEditor } from '../AnnoEqEditor';
import { BlockToolbar } from '../BlockToolbar';
import { InlineBlockEditor } from '../InlineEditor';
import { useStore } from '../../state/store';
import { AnchorRect, OrderPicker } from '../OrderPicker';
import { SlideMode } from './types';
import { defaultAnnoState } from '../../model/anno';
import { MediaPreparation } from '../../model/mediaResources';
import { editReferenceLabel } from '../referenceLabels';
import { IcoAt, IcoClock } from '../icons';

function TargetLabel({ label, list = false, hidden = false }: { label?: string; list?: boolean; hidden?: boolean }) {
  return label?.startsWith('ref:') ? <sup className={'ref-target-label' + (list ? ' ref-list-label' : '')}
    data-ref-label={label} style={hidden ? { visibility: 'hidden' } : undefined}>{genericRefText(label)}</sup> : null;
}

export const FlowBlock = memo(function FlowBlock({
  block, slide, deck, folder, computed, mode, revealed, onRef, highlight, highlightLabel, onZoom, resourceSnapshot, mediaActive,
}: {
  block: Block;
  slide: Slide | undefined;
  deck: Deck;
  folder: string;
  computed: Computed;
  mode: SlideMode;
  revealed?: Set<number>;
  onRef?: (label: string) => void;
  highlight?: boolean;
  highlightLabel?: string;
  onZoom?: (abs: string, ext: string, caption?: string) => void;
  resourceSnapshot?: MediaPreparation;
  mediaActive?: boolean;
}) {
  const { config } = deck;
  const lang = config.language;
  const textReference = block.type === 'paragraph' || block.type === 'itemize';
  const isEditing = useStore((s) => mode === 'edit' && !s.presenting && s.computed.pages[s.current]?.slide?.id === slide?.id && s.editing?.blockId === block.id && s.editing?.slideId === slide?.id);
  const setEditing = useStore((s) => s.setEditing);
  const jumpToRef = useStore((s) => s.jumpToRef);
  const updateBlock = useStore((s) => s.updateBlock);
  const cls = 'fblock' + (highlight ? ' flash-hl' : '') + (mode === 'edit' ? ' editable' : '');
  // 编辑态：图/视频边缘拖拽调宽（直接操作，写入 block.width 即显式设定）
  const onWidthChange = mode === 'edit' && slide
    ? (w: number) => updateBlock(slide.id, block.id, { width: w })
    : undefined;
  // 出现顺序快捷选择器状态：item=null=块级，否则为列表项下标；rect=徽章屏幕锚点
  const [ordPick, setOrdPick] = useState<{ rect: AnchorRect; item: number | null } | null>(null);
  const activeEditor = useStore((s) => mode === 'edit' && !s.presenting && s.computed.pages[s.current]?.slide?.id === slide?.id);
  useEffect(() => { if (!activeEditor) setOrdPick(null); }, [activeEditor]);
  const rectOf = (el: HTMLElement): AnchorRect => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const setItemOrder = (idx: number, o: number | undefined) => {
    if (!slide) return;
    const len = (block.items || []).length;
    if (idx >= len) return; // 选择器开启期间项数被外部缩减的防御（正常路径触不到）
    const next = Array.from({ length: len }, (_, k) => block.itemOrders?.[k]);
    next[idx] = o;
    updateBlock(slide.id, block.id, { itemOrders: next.some((x) => x != null) ? next : undefined });
  };
  const anim: CSSProperties | undefined =
    block.type !== 'itemize' && block.order != null && revealed
      ? revealed.has(block.order)
        ? { animation: 'rb-fade .4s ease' }
        : { visibility: 'hidden' }
      : undefined;
  const mediaPlaying = mediaActive !== false && (block.order == null || !revealed || revealed.has(block.order));

  const common = { computed, lang, palette: config.palette, onRef };
  const onScaleChange = mode === 'edit' && slide ? (scale: number) => updateBlock(slide.id, block.id, { anno: { ...(block.anno ?? defaultAnnoState()), scale } }) : undefined;
  let inner: JSX.Element | null = null;
  let panel: JSX.Element | null = null;
  if (isEditing && slide) {
    switch (block.type) {
      case 'paragraph':
        // 展示态/编辑态同用 .para 盒模型（margin/字号/行高一致）：进出编辑零重排。
        // 注意用 div 不用 p——InlineBlockEditor 渲染 div，p 套 div 是非法嵌套
        inner = <div className="para"><InlineBlockEditor slide={slide} block={block} /></div>;
        break;
      case 'itemize':
        inner = <div className="items-edit items-block"><TargetLabel label={block.label} list /><InlineBlockEditor slide={slide} block={block} /></div>;
        break;
      case 'equation':
        inner = <EquationView block={block} computed={computed} palette={config.palette} lang={lang} onRef={onRef} highlight={highlight} />;
        panel = <EquationEditor slide={slide} block={block} computed={computed} />;
        break;
      case 'annoeq':
        inner = <AnnoEquationView block={block} computed={computed} highlight={highlight} onScaleChange={onScaleChange} />;
        panel = <AnnoEqEditor slide={slide} block={block} />;
        break;
      case 'figure':
        inner = <FigureView block={block} folder={folder} onZoom={onZoom} {...common} onWidthChange={onWidthChange} preparation={resourceSnapshot} active={mediaPlaying} />;
        panel = <MediaPanel slide={slide} block={block} kind="figure" />;
        break;
      case 'video':
        inner = <VideoView block={block} folder={folder} onWidthChange={onWidthChange} mode={mode} active={mediaPlaying} />;
        panel = <MediaPanel slide={slide} block={block} kind="video" />;
        break;
      case 'table':
        inner = <TableView block={block} {...common} onWidthChange={onWidthChange} />;
        panel = <TableEditor slide={slide} block={block} />;
        break;
      default:
        inner = null;
    }
  } else {
    switch (block.type) {
      case 'paragraph':
        if (block.text) inner = <p className="para"><TargetLabel label={block.label} /><InlineText text={block.text} {...common} /></p>;
        // 空段落所有模式都渲染占位（空白不可见）：thumb 与画布测量口径必须一致，
        // 否则同一页两个扫描器结果不同 → pageLayout 两值来回写（可见振荡）
        else inner = <p className="para para-empty"><TargetLabel label={block.label} /></p>;
        break;
      case 'itemize':
        const targetHidden = !!revealed && !!block.label && !(block.items?.length
          ? block.items.some((_, i) => { const order = block.itemOrders?.[i] ?? block.order; return order == null || revealed.has(order); })
          : block.order == null || revealed.has(block.order));
        inner = (
          <div className="items-block"><TargetLabel label={block.label} list hidden={targetHidden} /><ul className="items">
            {(block.items || []).map((it, i) => {
              const io = block.itemOrders?.[i];
              const order = io ?? block.order;
              const liAnim: CSSProperties | undefined =
                order != null && revealed
                  ? revealed.has(order)
                    ? { animation: 'rb-fade .4s ease' }
                    : { visibility: 'hidden' }
                  : undefined;
              return (
                <li key={i} style={liAnim} data-ref-label={block.itemLabels?.[i]}
                  className={block.itemLabels?.[i] && block.itemLabels[i] === highlightLabel ? 'flash-hl' : undefined}>
                  <TargetLabel label={block.itemLabels?.[i]} /><InlineText text={it} {...common} />
                  {mode === 'edit' && activeEditor && slide && (
                    <button className={'li-ref' + (block.itemLabels?.[i] ? ' set' : '')}
                      aria-label="设置该项引用标签"
                      title={block.itemLabels?.[i] ?? '设置该项的引用标签'}
                      onClick={(e) => { e.stopPropagation(); void editReferenceLabel(slide.id, block.id, i); }}><IcoAt /></button>
                  )}
                  {mode === 'edit' && activeEditor && slide && (
                    <button
                      className={'li-ord' + (io != null ? ' set' : '') + (ordPick?.item === i ? ' open' : '')}
                      aria-label="设置该项出现顺序"
                      title={io != null ? `出现顺序 ${io}（点击修改/清除）` : '设置该项出现顺序'}
                      onClick={(e) => {
                        e.stopPropagation();
                        // 同步取锚点：合成事件派发结束后 currentTarget 即被置 null，
                        // 放进 setState updater 里读会掷 getBoundingClientRect of null（时机不定）
                        const rect = rectOf(e.currentTarget as HTMLElement);
                        setOrdPick((p) => (p?.item === i ? null : { rect, item: i }));
                      }}
                    >
                      {io != null ? `*${io}` : <IcoClock />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul></div>
        );
        break;
      case 'equation':
        inner = <EquationView block={block} computed={computed} palette={config.palette} lang={lang} onRef={onRef} highlight={highlight} />;
        break;
      case 'annoeq':
        inner = <AnnoEquationView block={block} computed={computed} highlight={highlight} onScaleChange={onScaleChange} />;
        break;
      case 'figure':
        inner = <FigureView block={block} folder={folder} onZoom={onZoom} {...common} onWidthChange={onWidthChange} still={mode === 'thumb'} print={mode === 'print'} preparation={resourceSnapshot} active={mediaPlaying} />;
        break;
      case 'video':
        inner = <VideoView block={block} folder={folder} onWidthChange={onWidthChange} mode={mode} active={mediaPlaying} />;
        break;
      case 'table':
        inner = <TableView block={block} {...common} onWidthChange={onWidthChange} />;
        break;
      default:
        inner = null;
    }
  }
  if (!inner) return null;

  if (mode !== 'edit' || !slide) {
    return <div className={cls} data-bid={block.id} style={anim}>{inner}</div>;
  }
  return (
    <div
      className={cls}
      data-bid={block.id}
      style={anim}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.ref-chip, .xref, .fig-zoom-btn, .edge-rz, .scale-handle, video, .inline-math, a, .btools-float, .btools-menu-float, .ord-badge, .ref-badge, .ord-picker, .li-ord, .li-ref')) {
          const chip = t.closest('.ref-chip') as HTMLAnchorElement | null;
          if (chip) {
            e.preventDefault();
            e.stopPropagation();
            const m = chip.getAttribute('href');
            if (m) jumpToRef(decodeURIComponent(m.replace(/^#/, '')));
          }
          return;
        }
        if (!isEditing) {
          setEditing({ slideId: slide.id, blockId: block.id });
        }
      }}
    >
      {!isEditing && (
        <BlockToolbar slide={slide} block={block} />
      )}
      {activeEditor && <div className={'block-badges' + (block.order != null || textReference && block.label || ordPick ? ' set' : '')}
        role="group" aria-label="块快捷设置" onClick={(e) => e.stopPropagation()}>
      <button
        className={'ord-badge' + (block.type === 'itemize' ? ' in-list' : '') + (block.order != null ? ' set' : '') + (ordPick != null && ordPick.item === null ? ' open' : '')}
        title={block.order != null ? `出现顺序 ${block.order}（点击修改/清除）` : '设置出现顺序'}
        aria-label={block.order != null ? `出现顺序 ${block.order}，点击修改或清除` : '设置出现顺序'}
        onClick={(e) => {
          e.stopPropagation();
          // 同步取锚点：合成事件派发结束后 currentTarget 即被置 null（同 li-ord 注）
          const rect = rectOf(e.currentTarget as HTMLElement);
          setOrdPick((p) => (p?.item === null ? null : { rect, item: null }));
        }}
      >
        {block.order != null ? <span className="ord-value">*{block.order}</span> : <IcoClock />}
      </button>
      {textReference && <button
        className={'ref-badge' + (block.type === 'itemize' ? ' in-list' : '') + (block.label ? ' set' : '')}
        aria-label={block.type === 'itemize' ? '设置整个列表的引用标签' : '设置文本块的引用标签'}
        title={block.label ? `引用标签：${block.label.replace(/^ref:/, '')}（点击修改或清除）`
          : block.type === 'itemize' ? '设置整个列表的引用标签' : '设置文本块的引用标签'}
        onClick={(e) => { e.stopPropagation(); void editReferenceLabel(slide.id, block.id); }}
      ><IcoAt /></button>}
      </div>}
      {activeEditor && ordPick && (
        <OrderPicker
          rect={ordPick.rect}
          current={ordPick.item != null ? block.itemOrders?.[ordPick.item] : block.order}
          onPick={(v) => {
            if (ordPick.item != null) setItemOrder(ordPick.item, v);
            else updateBlock(slide.id, block.id, { order: v });
            setOrdPick(null);
          }}
          onClose={() => setOrdPick(null)}
        />
      )}
      {inner}
      {panel}
    </div>
  );
});
