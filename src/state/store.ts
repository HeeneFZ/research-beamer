import { create } from 'zustand';
import {
  Block, BlockType, Deck, DeckConfig, Layout, Page, Slide, createDefaultConfig, newId,
} from '../model/types';
import { PageLayout } from '../model/layoutSpec';
import { setMediaRevision } from '../model/mediaGeometry';
import { absMediaPath } from '../model/mediaPaths';
import { OutlineAnchor, OutlineSource, planOutlineMove, stripOrphanSections } from '../model/outline';
import { MediaPreparation, emptyMediaPreparation } from '../model/mediaResources';
export { stripOrphanSections } from '../model/outline';
import { computeDeck, Computed, patchComputedSlide, refPageIndex, refParts } from '../model/numbering';
import { colEndPlan, colRegionAt, reseedColPlaceholders, stripEmptyColRegions } from '../model/segments';
import { serializeMarkdown, parseMarkdown, normLabel, LABEL_PREFIX, dedupeRefLabel } from '../model/markdown';
import { attachHistoryFolder, clearHistory, flushHistory, recordHistory, takeRedo, takeUndo } from './history';

export const PROJECT_DRAFT_FLUSH = 'beamer:flush-project-drafts';

/** UI editors commit synchronously before a persistence or project boundary. */
export function flushProjectDrafts(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(PROJECT_DRAFT_FLUSH));
  }
}

export interface FlashState {
  page: number;
  label?: string;
  nonce: number;
}

/** 正在编辑的块/页标题/节名/页脚附加信息/封面字段。节名编辑两种形态：
 *  sectionId 有值 = 重命名该节段；无值 = 从本页前新建 sectionLevel 级节 */
export interface EditState {
  slideId: string;
  blockId?: string;
  field?: 'title' | 'section' | 'footer' | 'coverTitle' | 'coverAuthors' | 'coverAff' | 'coverDate' | 'coverSub';
  sectionId?: string;
  sectionLevel?: 1 | 2 | 3;
}

/** 图片放大镜（EditorApp 式无限缩放预览） */
export interface LightboxState {
  abs: string;
  ext: string;
  caption?: string;
}

interface StoreState {
  deck: Deck;
  computed: Computed;
  folder: string | null;
  mediaRevision: number;
  mediaPreparation: MediaPreparation;
  current: number; // 当前页 index（computed.pages）
  dirty: boolean;
  /** Exit commits drafts first, then holds the saved project stable through apply/close. */
  projectExiting: boolean;
  darkMode: boolean;
  zoom: number; // 画布缩放系数；显示百分比 = zoom×100，zoom=1 恒为适页
  flash: FlashState | null;
  jumpStack: number[];
  flashMsg: string | null;
  /** 自动保存开关（应用级偏好，localStorage 持久化；E2E 模式恒禁用） */
  autoSave: boolean;
  editing: EditState | null;
  lightbox: LightboxState | null;
  focusId: string | null;
  focusPos: 'start' | 'end';
  revealStep: number;
  presentStart: number;
  presenting: boolean;
  presentSession: string | null;
  /** 放映窗录制态（放映窗 recState 事件回传；驱动放映台按钮） */
  presentRecording: boolean;
  /** 页级排版状态（key = slideId|aspect；内存态，不入 md/历史；全模式共享，
   *  由 useLayoutScan 静默探测写入，SlideView 各模式统一读取——编辑/胶片/放映/PDF 一致） */
  pageLayout: Record<string, PageLayout>;
  /** 块剪贴板（复制/粘贴按钮；内存态跨页跨工程有效，不入 md/历史） */
  clipBlock: Block | null;
  clipBlockFolder: string | null;
  copyBlock(slideId: string, blockId: string): void;
  pasteBlockAfter(slideId: string, afterId: string | null): string | null;

  setConfig(patch: Partial<DeckConfig>): void;
  updateSlide(slideId: string, patch: Partial<Slide>): void;
  updateBlock(slideId: string, blockId: string, patch: Partial<Block>): void;
  insertBlock(slideId: string, afterId: string | null, type: BlockType, init?: Partial<Block>): string;
  splitParagraph(slideId: string, blockId: string, before: string, after: string): string | null;
  mergeParagraph(slideId: string, blockId: string, text: string): string | null;
  deleteBlock(slideId: string, blockId: string): void;
  moveBlockBefore(slideId: string, blockId: string, beforeId: string | null): void;
  addSlide(layout: Layout, afterPage?: number): void;
  deleteSlide(slideId: string): void;
  duplicateSlide(slideId: string): void;
  addSectionBefore(slideId: string, title: string, level: 1 | 2 | 3): void;
  moveSlide(slideId: string, beforeId: string | null): void;
  moveOutline(source: OutlineSource, anchor: OutlineAnchor | null): void;
  renameSection(sectionId: string, title: string): void;
  jumpToRef(label: string): void;
  startPresent(): Promise<void>;
  endPresent(): void;
  presentAdvance(): void;
  presentSkip(): void;
  presentReverse(): void;
  insertColEnd(slideId: string, blockId: string): void;
  insertColRegion(slideId: string, afterId: string | null): string;
  setPageLayout(key: string, st: PageLayout): void;
  setMediaPreparation(preparation: MediaPreparation): void;
  setEditing(e: EditState | null): void;
  setFocus(id: string | null, pos?: 'start' | 'end'): void;
  setLightbox(l: LightboxState | null): void;
  toggleDarkMode(): void;
  setZoom(z: number): void;
  gotoPage(index: number, pushJump?: boolean): void;
  backJump(): void;
  setFlash(f: FlashState | null): void;
  setFlashMsg(m: string | null): void;
  toggleAutoSave(): void;

  prepareProjectExit(reason?: 'switch' | 'close'): boolean | Promise<boolean>;
  finishProjectExit(): void;
  newProject(): void | Promise<void>;
  openProject(): Promise<void>;
  loadProjectData(p: { md: string; folder: string }, refreshFromDisk?: boolean): void | Promise<void>;
  loadExample(relPath: string): Promise<void>;
  saveProject(flushDrafts?: boolean): Promise<boolean>;
  undo(): void;
  redo(): void;
}

function freshDeck(): Deck {
  return {
    config: createDefaultConfig(),
    items: [
      { kind: 'slide', slide: { id: newId(), layout: 'title', blocks: [] } },
      { kind: 'slide', slide: { id: newId(), layout: 'toc', blocks: [] } },
      { kind: 'slide', slide: { id: newId(), layout: 'content', title: '', blocks: [] } },
    ],
  };
}

/** deck 中按 id 取 slide（store 各 action 与编辑器键盘手柄共用，
 *  替代 9 处重复的 items.find + kind 收窄样板） */
export function slideOf(deck: Deck, slideId: string): Slide | null {
  const it = deck.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
  return it && it.kind === 'slide' ? it.slide : null;
}

function patchChanges<T extends object>(value: T, patch: Partial<T>): boolean {
  return (Object.keys(patch) as (keyof T)[]).some((key) => !Object.is(value[key], patch[key]));
}

const projectViewDefaults = {
  current: 0, editing: null, focusId: null, lightbox: null,
  jumpStack: [], flash: null, revealStep: 0, pageLayout: {},
};

export const useStore = create<StoreState>((set, get) => {
  let projectSession = 0;
  let loadRequest = 0;
  let saveTask: Promise<boolean> | null = null;
  let leaveTask: Promise<boolean> | null = null;
  let presentRequest = 0;

  /** 结构变更只复制根与 items；各内容操作负责复制被修改的分支。 */
  const mutate = (fn: (d: Deck) => void | false, debounce = true, compute?: (deck: Deck, previous: Computed) => Computed) => {
    const s = get();
    if (s.projectExiting) return;
    const d: Deck = { ...s.deck, items: s.deck.items.slice() };
    if (fn(d) === false) return;
    recordHistory(s.deck, debounce, d);
    const computed = compute ? compute(d, s.computed) : computeDeck(d);
    set({ deck: d, computed, dirty: true, current: Math.max(0, Math.min(s.current, computed.pages.length - 1)) });
  };

  const mutateSlide = (slideId: string, fn: (slide: Slide) => void | false, debounce = true) => {
    const at = d_indexOf(get().deck, slideId);
    if (at < 0) return;
    const before = slideOf(get().deck, slideId)!;
    mutate((d) => {
      const item = d.items[at];
      if (item.kind !== 'slide') return false;
      const slide = { ...item.slide, blocks: item.slide.blocks.slice() };
      if (fn(slide) === false) return false;
      d.items[at] = { kind: 'slide', slide };
    }, debounce, (d, previous) => {
      const after = d.items[at];
      return after.kind === 'slide' ? patchComputedSlide(previous, before, after.slide) ?? computeDeck(d) : computeDeck(d);
    });
  };

  const initial = freshDeck();
  return {
    deck: initial,
    computed: computeDeck(initial),
    folder: null,
    current: 0,
    dirty: false,
    projectExiting: false,
    darkMode: false,
    zoom: 1,
    flash: null,
    jumpStack: [],
    flashMsg: null,
    autoSave: typeof localStorage !== 'undefined' ? localStorage.getItem('beamerapp.autosave') !== 'off' : true,
    editing: null,
    lightbox: null,
    focusId: null,
    focusPos: 'end',
    revealStep: 0,
    presentStart: 0,
    presenting: false,
    presentSession: null,
    presentRecording: false,
    pageLayout: {},
    mediaRevision: 0,
    mediaPreparation: emptyMediaPreparation(),
    clipBlock: null,
    clipBlockFolder: null,

    /** 复制块到剪贴板（内存态；粘贴时重新生成 id/剥除全局唯一字段） */
    copyBlock: (slideId, blockId) => {
      const s = get();
      const sl = slideOf(s.deck, slideId);
      const b = sl ? sl.blocks.find((x) => x.id === blockId) : undefined;
      if (b) set({ clipBlock: JSON.parse(JSON.stringify(b)), clipBlockFolder: s.folder });
    },

    /** 粘贴块：插到 afterId 之后（与 insertBlock 同锚点语义）。
     *  剥除 label（全 deck 唯一键，副本会静默劫持 [@fig:x] 引用——同 duplicateSlide）；
     *  剥除 pos（自由定位块粘贴会与原件完全重叠，回流式更可预期）。 */
    pasteBlockAfter: (slideId, afterId) => {
      const s = get();
      if (!s.clipBlock || !slideOf(s.deck, slideId)) return null;
      const id = newId();
      const { label: _l, pos: _p, ...rest } = s.clipBlock;
      const copy: Block = { ...JSON.parse(JSON.stringify(rest)), id };
      if (copy.src && s.clipBlockFolder !== s.folder) copy.src = absMediaPath(s.clipBlockFolder ?? '', copy.src);
      mutateSlide(slideId, (sl) => {
        const at = afterId ? sl.blocks.findIndex((x) => x.id === afterId) : -1;
        if (at >= 0) sl.blocks.splice(at + 1, 0, copy);
        else sl.blocks.push(copy);
      }, false);
      return id;
    },

    setConfig: (patch) => {
      const before = get().deck.config;
      mutate((d) => {
        if (!patchChanges(d.config, patch)) return false;
        d.config = { ...d.config, ...patch };
      }, true, (d, previous) => before.numbering === d.config.numbering && before.sectionPages === d.config.sectionPages
        ? previous : computeDeck(d));
    },

    updateSlide: (slideId, patch) =>
      mutateSlide(slideId, (slide) => {
        if (!patchChanges(slide, patch)) return false;
        Object.assign(slide, patch);
      }),

    updateBlock: (slideId, blockId, patch) =>
      mutateSlide(slideId, (sl) => {
        const i = sl.blocks.findIndex((b) => b.id === blockId);
        if (i < 0) return false;
        const prev = sl.blocks[i];
        // LaTeX 源内 \label{..} 自愈（弹窗粘贴整段 LaTeX 的自然写法）：提取为块标签
        // 并从 latex 剥除——否则 KaTeX 不识别 \label 渲染成红色错误文本、标签也永不注册
        //（引用芯片红显裸标签）。Label 字段显式提供时字段优先。
        if (typeof patch.latex === 'string') {
          const lm = patch.latex.match(/\\label\{([^}]+)\}/);
          if (lm) {
            patch = { ...patch, latex: patch.latex.replace(lm[0], '').trim() };
            if (patch.label == null) patch = { ...patch, label: lm[1] };
          }
        }
        // label 归一（单一事实源）：所有面板/未来入口在此兜底——裸键补前缀、
        // 双重前缀剥除（dedupeRefLabel）、空白串视为清除。缺了这层，块上存
        // 'pos' 而查表键是 'eq:pos'，引用一律 eq(?)（annoeq 报障的另一半根因）
        if (patch.label != null) {
          const raw = String(patch.label).trim();
          if (!raw) patch = { ...patch, label: undefined };
          else {
            const normed = normLabel(LABEL_PREFIX[prev.type] ?? 'eq', dedupeRefLabel(raw));
            if (normed !== patch.label) patch = { ...patch, label: normed };
          }
        }
        // items 变更后 itemOrders 重对齐：公共前缀 + 公共后缀对齐（中部增删/改写段
        // 置 undefined）——纯按下标前缀对齐会在「删首项/中部插入」时把后续项顺序
        // 整体错一档；编辑器每次提交全量 items，无法携带对齐信息
        if (patch.items && prev.itemOrders && !Object.prototype.hasOwnProperty.call(patch, 'itemOrders')) {
          const oldItems = prev.items || [];
          const neu = patch.items;
          let p = 0;
          while (p < oldItems.length && p < neu.length && oldItems[p] === neu[p]) p++;
          let sfx = 0;
          while (
            sfx < oldItems.length - p && sfx < neu.length - p &&
            oldItems[oldItems.length - 1 - sfx] === neu[neu.length - 1 - sfx]
          ) sfx++;
          const norm = neu.map((_, k) => (
            neu.length === oldItems.length || k < p ? prev.itemOrders![k]
              : k >= neu.length - sfx ? prev.itemOrders![oldItems.length - (neu.length - k)]
                : undefined
          ));
          patch = { ...patch, itemOrders: norm.some((o) => o != null) ? norm : undefined };
        }
        if (!patchChanges(prev, patch)) return false;
        sl.blocks[i] = { ...prev, ...patch };
      }),

    insertBlock: (slideId, afterId, type, init) => {
      const id = newId();
      mutateSlide(slideId, (sl) => {
        const b: Block = { id, type, ...init };
        const at = afterId ? sl.blocks.findIndex((x) => x.id === afterId) : -1;
        if (at >= 0) sl.blocks.splice(at + 1, 0, b);
        else sl.blocks.push(b);
      }, false);
      return id;
    },

    deleteBlock: (slideId, blockId) =>
      mutateSlide(slideId, (sl) => {
        if (!sl.blocks.some((b) => b.id === blockId)) return false;
        // 删块后顺手收回空栏区：删光栏内最后一块时自动移除残留的 colmark/colend
        //（否则双栏分割线与栏容器永远渲染——「删光元素意图退出双栏」的用户路径）。
        // 单侧删空的栏区保留并补种占位段：空侧没有可点击目标则无处落新内容
        //（parse 路径由 reseedColPlaceholders 兜底，live 路径在此对齐）
        sl.blocks = reseedColPlaceholders(
          stripEmptyColRegions(sl.blocks.filter((b) => b.id !== blockId)),
          newId,
        );
      }, false),

    // Text and structure form one undoable action. Never merge across column/media boundaries.
    splitParagraph: (slideId, blockId, before, after) => {
      const id = newId();
      let inserted = false;
      mutateSlide(slideId, (slide) => {
        const at = slide.blocks.findIndex((block) => block.id === blockId && block.type === 'paragraph');
        if (at < 0) return false;
        slide.blocks[at] = { ...slide.blocks[at], text: before };
        slide.blocks.splice(at + 1, 0, { id, type: 'paragraph', text: after });
        inserted = true;
      }, false);
      return inserted ? id : null;
    },
    mergeParagraph: (slideId, blockId, text) => {
      let target: string | null = null;
      mutateSlide(slideId, (slide) => {
        const at = slide.blocks.findIndex((block) => block.id === blockId);
        const previous = slide.blocks[at - 1];
        if (at < 1 || previous.type !== 'paragraph' || slide.blocks[at].type !== 'paragraph') return false;
        slide.blocks[at - 1] = { ...previous, text: (previous.text ?? '') + text };
        slide.blocks.splice(at, 1);
        target = previous.id;
      }, false);
      return target;
    },

    /** 拖拽调序：把 blockId 移动到 beforeId 之前（beforeId=null 移到所在栏末尾）。
     *  栏安全：beforeId 必须与 blockId 同栏（colmark/colend 之间），否则忽略。 */
    moveBlockBefore: (slideId, blockId, beforeId) =>
      mutateSlide(slideId, (sl) => {
        const blocks = sl.blocks;
        const at = moveTargetOf(blocks, blockId, beforeId);
        if (at == null) return false;
        const from = blocks.findIndex((b) => b.id === blockId);
        const [b] = blocks.splice(from, 1);
        blocks.splice(at, 0, b);
      }, false),

    addSlide: (layout, afterPage) => {
      const s = get();
      let anchorItem = -1; // deck.items 中插入位置（其后）
      if (afterPage != null && afterPage >= 0 && afterPage < s.computed.pages.length) {
        const p = s.computed.pages[afterPage];
        if (p.kind === 'slide') {
          anchorItem = d_indexOf(s.deck, p.slide!.id);
        } else if (p.kind === 'divider' && p.section) {
          anchorItem = d_indexOfSection(s.deck, p.section.id);
        }
      }
      const slideId = newId();
      mutate((d) => {
        const slide: Slide = { id: slideId, layout, blocks: [] };
        if (layout === 'twoCol') {
          slide.blocks = [
            { id: newId(), type: 'colmark' },
            { id: newId(), type: 'paragraph', text: '' },
            { id: newId(), type: 'colmark' },
            { id: newId(), type: 'paragraph', text: '' },
          ];
        }
        const at = anchorItem >= 0 ? anchorItem + 1 : d.items.length;
        d.items.splice(at, 0, { kind: 'slide', slide });
      }, false);
      // 插入后选中新页
      const c = get().computed;
      const idx = c.pages.findIndex((pg) => pg.kind === 'slide' && pg.slide?.id === slideId);
      if (idx >= 0) set({ current: idx });
    },

    deleteSlide: (slideId) => {
      const s = get();
      const idx = d_indexOf(s.deck, slideId);
      if (idx < 0) return;
      const selected = s.computed.pages[s.current];
      mutate((d) => {
        d.items.splice(idx, 1);
        // 删页可能留下无页面归属的孤儿节标题（含链式），一并清理——
        // 否则残留小节会抢占其后新建章节的归属（用户实测报障）
        d.items = stripOrphanSections(d.items);
      }, false);
      const pages = get().computed.pages;
      const selectedIndex = selected ? pages.findIndex((page) => selected.kind === 'slide'
        ? page.slide?.id === selected.slide?.id : page.section?.id === selected.section?.id) : -1;
      // 清理该页的排版缓存孤儿键（防长会话「建页-删页」单调增长；undo 后重新扫描即可）
      set((st) => ({
        current: selectedIndex >= 0 ? selectedIndex : Math.min(s.current, Math.max(0, pages.length - 1)),
        ...(selected?.slide?.id === slideId ? { editing: null, focusId: null, revealStep: 0 } : {}),
        pageLayout: Object.fromEntries(Object.entries(st.pageLayout).filter(([k]) => !k.startsWith(slideId + '|'))),
      }));
    },

    duplicateSlide: (slideId) => {
      const s = get();
      const idx = d_indexOf(s.deck, slideId);
      if (idx < 0) return;
      const src = s.deck.items[idx];
      if (src.kind !== 'slide') return;
      const copy: Slide = structuredClone(src.slide);
      // 复制页须剥除交叉引用标签：label 是全 deck 唯一键（编号/跳转按 label 索引，
      // 重复后者覆盖前者，[@fig:x] 会静默指向副本），副本块不带走原标签
      const reId = (b: Block): Block => {
        const { label: _stripped, ...rest } = b;
        return { ...rest, id: newId() };
      };
      copy.id = newId();
      copy.blocks = copy.blocks.map(reId);
      mutate((d) => {
        d.items.splice(idx + 1, 0, { kind: 'slide', slide: copy });
      }, false);
      const current = get().computed.pages.findIndex((page) => page.slide?.id === copy.id);
      set({ current, editing: null, focusId: null, revealStep: 0 });
    },

    /** 在指定页前新建节（页眉面包屑＋/菜单入口）：节分隔页由 computeDeck 自动生成 */
    addSectionBefore: (slideId, title, level) => {
      const s = get();
      const idx = d_indexOf(s.deck, slideId);
      if (idx < 0) return;
      mutate((d) => {
        d.items.splice(idx, 0, { kind: 'section', section: { id: newId(), level, title, label: undefined } });
      }, false);
    },

    moveSlide: (slideId, beforeId) => get().moveOutline({ kind: 'slide', id: slideId }, beforeId ? { kind: 'slide', id: beforeId, position: 'before' } : null),
    moveOutline: (source, anchor) => {
      const state = get();
      const plan = planOutlineMove(state.deck.items, source, anchor);
      if (!plan) return;
      mutate((deck) => { deck.items = stripOrphanSections(plan.items, plan.candidates); }, false);
      const computed = get().computed;
      const current = source.kind === 'slide'
        ? computed.pages.findIndex((page) => page.slide?.id === source.id)
        : computed.sectionPageIndex.get(source.id);
      if (current != null && current >= 0) set({ current, editing: null, focusId: null, revealStep: 0 });
    },
    renameSection: (sectionId, title) =>
      mutate((d) => {
        const i = d.items.findIndex((x) => x.kind === 'section' && x.section.id === sectionId);
        const it = d.items[i];
        if (!it || it.kind !== 'section' || it.section.title === title) return false;
        d.items[i] = { kind: 'section', section: { ...it.section, title } };
      }),
    /** 结束双栏区：点击块逃出栏区成为首个单栏块（语义与开始双栏区对称）。
     *  落点/清理由 colEndPlan 纯函数决定——colend 插在点击块之前，
     *  旧 colend / 切栏标记按需删除，栏区清空则连开栏标记一起移除。 */
    insertColEnd: (slideId, blockId) => {
      mutateSlide(slideId, (sl) => {
        const plan = colEndPlan(sl.blocks, blockId);
        if (!plan) return false;
        // 删除下标全部大于插入点（开栏标记只在「栏区清空不插入」分支删除），先删后插无需换算
        for (const i of [...plan.deleteIdx].sort((a, b) => b - a)) sl.blocks.splice(i, 1);
        if (plan.insertAt >= 0) sl.blocks.splice(plan.insertAt, 0, { id: newId(), type: 'colend' });
      }, false);
    },

    /** 原子插入双栏区：colmark+左空段+colmark+右空段（单次 mutate，无中间渲染态）。
     *  点击块在栏区内时新栏区让位到该栏区终结处（栏区不可嵌套）。
     *  落点须避开「栏区仍开着」的位置：组的首个 colmark 会把未切栏的栏区切成
     *  右栏（新组被吸进旧栏区），故取栏区终结标记——显式 colend 之前
     *  （colend 改收新栏区，后续内容不动）；无显式收栏则取隐式终结标记
     *  （下一个 colmark/colend）之前或页尾。 */
    insertColRegion: (slideId, afterId) => {
      const leftId = newId();
      mutateSlide(slideId, (sl) => {
        const blocks = sl.blocks;
        const at = afterId ? blocks.findIndex((b) => b.id === afterId) : -1;
        const reg = at >= 0 && afterId ? colRegionAt(blocks, afterId) : null;
        let idx: number;
        if (!reg) {
          idx = at >= 0 ? at + 1 : blocks.length;
        } else if (reg.endIdx >= 0) {
          idx = reg.endIdx;
        } else {
          idx = blocks.length;
          const bodyEnd = Math.max(reg.lastIdx, reg.switchIdx);
          for (let i = bodyEnd + 1; i < blocks.length; i++) {
            if (blocks[i].type === 'colmark' || blocks[i].type === 'colend') { idx = i; break; }
          }
        }
        blocks.splice(idx, 0,
          { id: newId(), type: 'colmark' },
          { id: leftId, type: 'paragraph', text: '' },
          { id: newId(), type: 'colmark' },
          { id: newId(), type: 'paragraph', text: '' },
        );
      }, false);
      return leftId;
    },

    gotoPage: (index, pushJump) => {
      const s = get();
      const n = s.computed.pages.length;
      const i = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : 0, n - 1));
      set({
        current: i,
        ...(i !== s.current ? { editing: null, focusId: null } : {}),
        jumpStack: pushJump ? [...s.jumpStack, s.current] : s.jumpStack,
        revealStep: 0,
        // 跳转高亮是「到达即提示」的一次性事件：离开目标页即失效（防返回时动画重放）
        flash: s.flash && s.flash.page !== i ? null : s.flash,
      });
    },

    /** 引用跳转（编辑画布与放映共用）：解析 label → 跳页 + 历史栈 + 高亮 */
    jumpToRef: (label) => {
      const target = refPageIndex(label, get().computed);
      if (target == null) return;
      get().gotoPage(target, true);
      const parts = refParts(label.includes(':') ? label : `eq:${label}`);
      set({ flash: { page: target, label: parts?.key, nonce: Date.now() } });
    },

    startPresent: async () => {
      // Buffered modal fields must be explicitly committed before changing mode.
      if (document.querySelector('.modal-mask, .field-popover, .math-float') || get().lightbox) return;
      if (get().mediaPreparation.phase !== 'ready') return;
      if (get().presenting) return;
      const request = ++presentRequest;
      const presentSession = `${performance.timeOrigin}:${request}`;
      set({ presenting: true, presentSession, revealStep: 0, presentStart: 0, editing: null, lightbox: null });
      try {
        const result = await window.api.openPresent({ session: presentSession });
        if (!result.ok) throw new Error(result.error ?? '投影窗口打开失败');
      } catch (error) {
        if (request === presentRequest) set({ presenting: false, presentSession: null, presentRecording: false, flashMsg: '放映启动失败：' + String(error) });
      }
    },

    endPresent: () => {
      presentRequest++;
      set({ presenting: false, presentSession: null, presentRecording: false });
      void window.api.closePresent();
    },

    presentAdvance: () => {
      const s = get();
      const orders = pageOrders(s.computed.pages[s.current]);
      if (s.revealStep < orders.length) set({ revealStep: s.revealStep + 1 });
      else if (s.current < s.computed.pages.length - 1) get().gotoPage(s.current + 1);
    },

    presentSkip: () => {
      const s = get();
      const orders = pageOrders(s.computed.pages[s.current]);
      if (s.revealStep < orders.length) set({ revealStep: orders.length });
      else if (s.current < s.computed.pages.length - 1) get().gotoPage(s.current + 1);
    },

    presentReverse: () => {
      const s = get();
      if (s.revealStep > 0) {
        set({ revealStep: s.revealStep - 1 });
        return;
      }
      if (s.current > 0) {
        const prev = s.computed.pages[s.current - 1];
        get().gotoPage(s.current - 1);
        set({ revealStep: pageOrders(prev).length });
      }
    },

    setEditing: (e) => set({ editing: e }),
    setFocus: (id, pos = 'end') => {
      // setFocus 的合约语义是「进入该文本块编辑并落焦点到 pos」：编辑器挂载依赖
      // editing 态（FlowBlock 按 editing.blockId 渲染 InlineBlockEditor），
      // 只设 focusId 不进编辑态则焦点无处安放（＋菜单插段落曾静默无编辑器）
      if (id) {
        for (const it of get().deck.items) {
          if (it.kind !== 'slide') continue;
          const b = it.slide.blocks.find((x) => x.id === id);
          if (b && (b.type === 'paragraph' || b.type === 'itemize')) {
            set({ editing: { slideId: it.slide.id, blockId: id } });
            break;
          }
        }
      }
      set({ focusId: id, focusPos: pos });
    },
    setLightbox: (l) => set({ lightbox: l }),
    toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    setZoom: (z) => set({ zoom: Math.max(0.3, Math.min(3, z)) }),

    backJump: () => {
      const s = get();
      if (!s.jumpStack.length) return;
      const stack = [...s.jumpStack];
      const back = stack.pop()!;
      get().gotoPage(back);
      set({ jumpStack: stack });
    },

    setFlash: (f) => set({ flash: f }),
    setFlashMsg: (m) => set({ flashMsg: m }),

    /** 自动保存开关：应用级偏好，localStorage 持久化 */
    toggleAutoSave: () =>
      set((s) => {
        const autoSave = !s.autoSave;
        try { localStorage.setItem('beamerapp.autosave', autoSave ? 'on' : 'off'); } catch { /* localStorage 不可用时忽略 */ }
        return { autoSave };
      }),

    /** 页级排版状态（扫描器静默探测写入；与现值相同则不触发更新） */
    setPageLayout: (key, st) =>
      set((s) => {
        const cur = s.pageLayout[key];
        if (cur && cur.signature === st.signature && cur.s === st.s && cur.imgH === st.imgH && cur.fit === st.fit) return s;
        return { pageLayout: { ...s.pageLayout, [key]: st } };
      }),
    setMediaPreparation: (mediaPreparation) => set({ mediaPreparation }),

    prepareProjectExit: (reason = 'switch') => {
      if (leaveTask) return leaveTask;
      if (get().projectExiting) return true;
      flushProjectDrafts();
      const state = get();
      // Pure model tests and E2E never save or ask about their fixture projects.
      if (!window.api || window.api.isE2E) return true;
      set({ projectExiting: true });
      const session = projectSession;
      const historyReady = () => {
        const report = (ok: boolean) => {
          if (!ok && session === projectSession) set({ flashMsg: '撤销历史未保存，操作已取消' });
          return ok;
        };
        const result = flushHistory();
        return typeof result === 'boolean' ? report(result) : result.then(report);
      };
      const work = !state.dirty && !saveTask ? historyReady() : (async () => {
        if (saveTask && (!await saveTask || session !== projectSession)) return false;
        const current = get();
        if (!current.dirty) return historyReady();
        if (!(current.autoSave && current.folder)) {
          const choice = await window.api.confirmProjectExit({ title: current.deck.config.title, language: current.deck.config.language, reason });
          if (session !== projectSession || choice === 'cancel') return false;
          if (choice === 'discard') return historyReady();
        }
        if (!await get().saveProject(false) || session !== projectSession) return false;
        return historyReady();
      })();
      if (typeof work === 'boolean') {
        if (!work) set({ projectExiting: false });
        return work;
      }
      const task = work.catch((error) => {
        if (session === projectSession) set({ flashMsg: '操作未完成：' + String(error) });
        return false;
      });
      leaveTask = task;
      void task.then((ok) => {
        if (leaveTask === task) leaveTask = null;
        if (!ok && session === projectSession) set({ projectExiting: false });
      });
      return task;
    },

    finishProjectExit: () => { if (get().projectExiting) set({ projectExiting: false }); },

    newProject: () => {
      if (get().projectExiting) return;
      const request = ++loadRequest;
      const apply = () => {
        if (request !== loadRequest) return;
        if (get().presenting) get().endPresent();
        projectSession++;
        loadRequest++;
        clearHistory();
        attachHistoryFolder(null, '');
        const d = freshDeck();
        const mediaRevision = get().mediaRevision + 1;
        setMediaRevision(mediaRevision);
        set({ deck: d, computed: computeDeck(d), folder: null, dirty: false, projectExiting: false, ...projectViewDefaults, mediaRevision, mediaPreparation: emptyMediaPreparation() });
      };
      const allowed = get().prepareProjectExit();
      if (typeof allowed === 'boolean') {
        try { if (allowed) apply(); } finally { get().finishProjectExit(); }
        return;
      }
      return allowed.then((ok) => { if (ok) apply(); }).finally(() => get().finishProjectExit());
    },

    openProject: async () => {
      if (get().projectExiting) return;
      const request = ++loadRequest;
      try {
        const r = await window.api.openProject();
        if (request !== loadRequest || !r) return;
        if (r.error) { set({ flashMsg: '打开失败：' + r.error }); return; }
        if (r.md == null) { set({ flashMsg: '工程中未找到 deck.md' }); return; }
        await get().loadProjectData({ md: r.md, folder: r.folder }, true);
      } catch (e) {
        if (request === loadRequest) set({ flashMsg: '打开失败：' + String(e) });
      }
    },

    loadProjectData: ({ md, folder }, refreshFromDisk = false) => {
      if (get().projectExiting) return;
      try {
        const refresh = refreshFromDisk && !!window.api && !window.api.isE2E;
        const initialDeck = refresh ? null : parseMarkdown(md);
        const initialComputed = initialDeck ? computeDeck(initialDeck) : null;
        const request = ++loadRequest;
        const apply = (deck: Deck, computed: Computed) => {
          if (request !== loadRequest) return;
          if (get().presenting) get().endPresent();
          projectSession++;
          loadRequest++;
          clearHistory();
          // 历史 adopt：读回该工程目录下的 .beamer-history.json 恢复撤销栈
          attachHistoryFolder(folder, JSON.stringify(deck));
          const mediaRevision = get().mediaRevision + 1;
          setMediaRevision(mediaRevision);
          set({ deck, computed, folder, dirty: false, projectExiting: false, ...projectViewDefaults, mediaRevision, mediaPreparation: emptyMediaPreparation() });
        };
        const allowed = get().prepareProjectExit();
        if (refresh) {
          return (async () => {
            if (!await allowed || request !== loadRequest) return;
            // Save may have written into the selected folder, including Save As.
            // Read the selected project only after that exit transaction finishes.
            const result = await window.api.readFile(absMediaPath(folder, 'deck.md'));
            if (request !== loadRequest) return;
            if ('error' in result) throw new Error(result.error);
            const deck = parseMarkdown(new TextDecoder('utf-8', { fatal: true }).decode(result.data));
            apply(deck, computeDeck(deck));
          })().catch((error) => {
            if (request === loadRequest) set({ flashMsg: '工程读取失败：' + String(error) });
          }).finally(() => { if (request === loadRequest) get().finishProjectExit(); });
        }
        if (typeof allowed === 'boolean') {
          try { if (allowed) apply(initialDeck!, initialComputed!); } finally { get().finishProjectExit(); }
          return;
        }
        return allowed.then((ok) => { if (ok) apply(initialDeck!, initialComputed!); }).finally(() => get().finishProjectExit());
      } catch (e) {
        set({ flashMsg: '工程解析失败：' + String(e) });
      }
    },

    loadExample: async (relPath) => {
      if (get().projectExiting) return;
      const request = ++loadRequest;
      try {
        const r = await window.api.loadExample(relPath);
        if (request !== loadRequest) return;
        if (!r || r.md == null) {
          set({ flashMsg: r?.error ? '打开失败：' + r.error : '示例不存在：' + relPath });
          return;
        }
        await get().loadProjectData({ md: r.md, folder: r.folder }, true);
      } catch (e) {
        if (request === loadRequest) set({ flashMsg: '打开失败：' + String(e) });
      }
    },

    saveProject: async (flushDrafts = true) => {
      if (flushDrafts) flushProjectDrafts();
      const session = projectSession;
      while (saveTask) {
        if (!await saveTask || session !== projectSession) return false;
        if (!get().dirty && get().folder) return true;
      }
      const task = (async () => {
        const s = get();
        try {
          const r = await window.api.saveProject({ folder: s.folder, md: serializeMarkdown(s.deck) });
          if (session !== projectSession) return false;
          if (r?.error) { set({ flashMsg: '保存失败：' + r.error }); return false; }
          if (!r?.folder) return false;
          if (s.folder !== r.folder) attachHistoryFolder(r.folder, JSON.stringify(s.deck), false);
          set({ folder: r.folder, dirty: get().deck !== s.deck, flashMsg: '已保存 → ' + r.folder });
          return true;
        } catch (e) {
          if (session === projectSession) set({ flashMsg: '保存失败：' + String(e) });
          return false;
        }
      })();
      saveTask = task;
      try { return await task; }
      finally { if (saveTask === task) saveTask = null; }
    },

    undo: () => {
      if (get().projectExiting) return;
      const deck = takeUndo(get().deck);
      if (!deck) return;
      const computed = computeDeck(deck);
      set((s) => ({ deck, computed, dirty: true, current: Math.max(0, Math.min(s.current, computed.pages.length - 1)) }));
    },

    redo: () => {
      if (get().projectExiting) return;
      const deck = takeRedo(get().deck);
      if (!deck) return;
      const computed = computeDeck(deck);
      set((s) => ({ deck, computed, dirty: true, current: Math.max(0, Math.min(s.current, computed.pages.length - 1)) }));
    },
  };
});

function d_indexOf(deck: Deck, slideId: string): number {
  return deck.items.findIndex((x) => x.kind === 'slide' && x.slide.id === slideId);
}

/** 栏内调序目标位计算（moveBlockBefore 与 BlockToolbar 共用）：
 *  返回块删除后的插入下标；跨栏段（colmark/colend 之间）或位置未变返回 null——
 *  调用方据此 disable 按钮，而非点击后静默失效 */
export function moveTargetOf(blocks: Block[], blockId: string, beforeId: string | null): number | null {
  const from = blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return null;
  const marks = blocks.map((b, i) => ((b.type === 'colmark' || b.type === 'colend') ? i : -1)).filter((i) => i >= 0);
  const segStart = marks.filter((i) => i < from).reduce((a, i) => Math.max(a, i + 1), 0);
  const segEnd = marks.find((i) => i > from) ?? blocks.length; // 不含
  let target: number;
  if (beforeId == null) {
    target = segEnd;
  } else {
    const bi = blocks.findIndex((b) => b.id === beforeId);
    if (bi < 0 || bi < segStart || bi >= segEnd) return null; // 跨栏不支持
    target = bi;
  }
  if (target === from || target === from + 1) return null; // 位置未变
  return from < target ? target - 1 : target;
}

function d_indexOfSection(deck: Deck, sectionId: string): number {
  return deck.items.findIndex((x) => x.kind === 'section' && x.section.id === sectionId);
}

/** 当前页对应的可编辑 slide（divider 页取其后第一张 slide；无则取其前；均无 null） */
export function editableSlideOf(page: Page | undefined, pages: Page[]): Slide | null {
  if (!page) return null;
  if (page.kind === 'slide' && page.slide) return page.slide;
  for (let i = (page?.index ?? 0) + 1; i < pages.length; i++) {
    const pg = pages[i];
    if (pg.kind === 'slide' && pg.slide) return pg.slide;
  }
  for (let i = (page?.index ?? 0) - 1; i >= 0; i--) {
    const pg = pages[i];
    if (pg.kind === 'slide' && pg.slide) return pg.slide;
  }
  return null;
}

/** 当前页出现动画档位：去重升序的 order 值（含 itemize 逐项 itemOrders） */
export function pageOrders(page: { kind: string; slide?: { blocks: { type?: string; items?: string[]; order?: number; itemOrders?: (number | undefined)[] }[] } } | undefined): number[] {
  const orders: number[] = [];
  for (const b of page?.slide?.blocks || []) {
    if (b.type === 'itemize') {
      for (let i = 0; i < (b.items?.length ?? 0); i++) {
        const order = b.itemOrders?.[i] ?? b.order;
        if (order != null) orders.push(order);
      }
    } else {
      if (b.order != null) orders.push(b.order);
      if (!b.type && b.itemOrders) for (const order of b.itemOrders) if (order != null) orders.push(order);
    }
  }
  return [...new Set(orders)].sort((a, b) => a - b);
}
