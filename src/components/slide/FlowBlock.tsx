// 单个流式块：编辑态/展示态分发 + 块点击进编辑 + BlockToolbar 挂载

import { CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { Block, Deck, Slide } from '../../model/types';
import { Computed } from '../../model/numbering';
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

export function FlowBlock({
  block, slide, deck, folder, computed, mode, revealed, onRef, highlight, onZoom,
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
  onZoom?: (abs: string, ext: string, caption?: string) => void;
}) {
  const { config } = deck;
  const lang = config.language;
  const editing = useStore((s) => mode === 'edit' ? s.editing : null);
  const setEditing = useStore((s) => s.setEditing);
  const jumpToRef = useStore((s) => s.jumpToRef);
  const updateBlock = useStore((s) => s.updateBlock);
  const isEditing = mode === 'edit' && editing != null && editing.blockId === block.id && editing.slideId === slide?.id;
  const cls = 'fblock' + (highlight ? ' flash-hl' : '') + (mode === 'edit' ? ' editable' : '');
  // 进出编辑零跳动（钉子法）：文本块进入编辑时 contenteditable 的行盒度量与静态渲染有
  // 亚像素级差异（实测 +1.3px，white-space/ligatures 等 CSS 对齐均无法消除）。进编辑瞬间
  // 把块钉死为「展示态高度 + 展示态间距」：显式 height 阻断子元素 margin 坍塌穿透，
  // 编辑态高出的 ~1px 溢进块间空白（>=19px）不可见；ResizeObserver 发现内容真实增长
  // 超 8px 才释放钉子恢复自然流；退出编辑时释放（展示态总高=钉住总高，双向零位移）。
  // 仅文本块（段落/列表）；带 panel 的块（公式/图/表）编辑态本来就会重排，不钉。
  // ⚠ 单位陷阱：画布用 transform: scale 缩放（EditorCanvas），getBoundingClientRect 是
  // 缩放后的绘制坐标，写进 style 会被再放大一次（曾致 +35px 回移）——测量必须一律用
  // getComputedStyle/布局级 CSS px，禁用 rect。
  const rootRef = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState<{ h: number; mb: number } | null>(null);
  const isTextBlock = block.type === 'paragraph' || block.type === 'itemize';
  useLayoutEffect(() => {
    if (!isEditing && pin) setPin(null);
  }, [isEditing, pin]);
  useLayoutEffect(() => {
    if (!isEditing || !pin || !rootRef.current) return;
    const pm = rootRef.current.querySelector('.ProseMirror');
    if (!pm) return;
    const ro = new ResizeObserver(() => {
      if (parseFloat(getComputedStyle(pm).height) > pin.h + 8) setPin(null);
    });
    ro.observe(pm);
    return () => ro.disconnect();
  }, [isEditing, pin]);
  // 编辑态：图/视频边缘拖拽调宽（直接操作，写入 block.width 即显式设定）
  const onWidthChange = mode === 'edit' && slide
    ? (w: number) => updateBlock(slide.id, block.id, { width: w })
    : undefined;
  // 出现顺序快捷选择器状态：item=null=块级，否则为列表项下标；rect=徽章屏幕锚点
  const [ordPick, setOrdPick] = useState<{ rect: AnchorRect; item: number | null } | null>(null);
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
    block.order != null && revealed
      ? revealed.has(block.order)
        ? { animation: 'rb-fade .4s ease' }
        : { visibility: 'hidden' }
      : undefined;

  const common = { computed, lang, palette: config.palette, onRef };
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
        inner = <div className="items-edit"><InlineBlockEditor slide={slide} block={block} /></div>;
        break;
      case 'equation':
        inner = <EquationView block={block} computed={computed} palette={config.palette} lang={lang} onRef={onRef} highlight={highlight} />;
        panel = <EquationEditor slide={slide} block={block} computed={computed} />;
        break;
      case 'annoeq':
        inner = <AnnoEquationView block={block} computed={computed} highlight={highlight} />;
        panel = <AnnoEqEditor slide={slide} block={block} />;
        break;
      case 'figure':
        inner = <FigureView block={block} folder={folder} onZoom={onZoom} {...common} onWidthChange={onWidthChange} />;
        panel = <MediaPanel slide={slide} block={block} kind="figure" />;
        break;
      case 'video':
        inner = <VideoView block={block} folder={folder} onWidthChange={onWidthChange} mode={mode} />;
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
        if (block.text) inner = <p className="para"><InlineText text={block.text} {...common} /></p>;
        // 空段落所有模式都渲染占位（空白不可见）：thumb 与画布测量口径必须一致，
        // 否则同一页两个扫描器结果不同 → pageLayout 两值来回写（可见振荡）
        else inner = <p className="para para-empty" />;
        break;
      case 'itemize':
        inner = (
          <ul className="items">
            {(block.items || []).map((it, i) => {
              const io = block.itemOrders?.[i];
              const liAnim: CSSProperties | undefined =
                io != null && revealed
                  ? revealed.has(io)
                    ? { animation: 'rb-fade .4s ease' }
                    : { visibility: 'hidden' }
                  : undefined;
              return (
                <li key={i} style={liAnim}>
                  <InlineText text={it} {...common} />
                  {mode === 'edit' && slide && (
                    <button
                      className={'li-ord' + (io != null ? ' set' : '') + (ordPick?.item === i ? ' open' : '')}
                      title={io != null ? `出现顺序 ${io}（点击修改/清除）` : '设置该项出现顺序'}
                      onClick={(e) => {
                        e.stopPropagation();
                        // 同步取锚点：合成事件派发结束后 currentTarget 即被置 null，
                        // 放进 setState updater 里读会掷 getBoundingClientRect of null（时机不定）
                        const rect = rectOf(e.currentTarget as HTMLElement);
                        setOrdPick((p) => (p?.item === i ? null : { rect, item: i }));
                      }}
                    >
                      {io != null ? io : '⏱'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        );
        break;
      case 'equation':
        inner = <EquationView block={block} computed={computed} palette={config.palette} lang={lang} onRef={onRef} highlight={highlight} />;
        break;
      case 'annoeq':
        inner = <AnnoEquationView block={block} computed={computed} highlight={highlight} />;
        break;
      case 'figure':
        inner = <FigureView block={block} folder={folder} onZoom={onZoom} {...common} onWidthChange={onWidthChange} still={mode === 'thumb'} />;
        break;
      case 'video':
        inner = <VideoView block={block} folder={folder} onWidthChange={onWidthChange} mode={mode} />;
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
      ref={rootRef}
      className={cls}
      data-bid={block.id}
      style={isEditing && pin ? { ...(anim || {}), height: pin.h, marginBottom: pin.mb } : anim}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.ref-chip, .xref, .fig-zoom-btn, .edge-rz, video, .inline-math, a, .btools-float, .btools-menu-float, .ord-badge, .ord-picker, .li-ord')) {
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
          if (isTextBlock) {
            const el = e.currentTarget as HTMLElement;
            // 钉子取值：块高=根盒 computed 高（布局 CSS px，免疫画布 transform scale）；
            // 间距=展示态间距载体（.para/.items）的 marginBottom（.fblock 自身无 margin，
            // 兄弟间隙全部来自该载体坍塌穿透，故显式钉回即精确相等）
            const carrier = el.querySelector('.para, .items');
            if (carrier) {
              setPin({
                h: parseFloat(getComputedStyle(el).height),
                mb: parseFloat(getComputedStyle(carrier).marginBottom) || 0,
              });
            }
          }
          setEditing({ slideId: slide.id, blockId: block.id });
        }
      }}
    >
      {!isEditing && (
        <BlockToolbar slide={slide} block={block} />
      )}
      <button
        className={'ord-badge' + (block.type === 'itemize' ? ' in-list' : '') + (block.order != null ? ' set' : '') + (ordPick != null && ordPick.item === null ? ' open' : '')}
        title={block.order != null ? `出现顺序 ${block.order}（点击修改/清除）` : '设置出现顺序'}
        onClick={(e) => {
          e.stopPropagation();
          // 同步取锚点：合成事件派发结束后 currentTarget 即被置 null（同 li-ord 注）
          const rect = rectOf(e.currentTarget as HTMLElement);
          setOrdPick((p) => (p?.item === null ? null : { rect, item: null }));
        }}
      >
        {block.order != null ? block.order : '⏱'}
      </button>
      {ordPick && (
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
}
