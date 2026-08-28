import { create } from 'zustand';
import {
  Block, BlockType, Deck, DeckConfig, DeckItem, Layout, Page, Slide, defaultConfig, newId,
} from '../model/types';
import { SpacingState } from '../model/layoutSpec';
import { computeDeck, Computed, refPageIndex, refParts } from '../model/numbering';
import { colEndPlan, colRegionAt, stripEmptyColRegions } from '../model/segments';
import { serializeMarkdown, parseMarkdown, normLabel, LABEL_PREFIX, dedupeRefLabel } from '../model/markdown';
import { attachHistoryFolder, clearHistory, recordHistory, takeRedo, takeUndo } from './history';

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
  current: number; // 当前页 index（computed.pages）
  dirty: boolean;
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
  /** 页级排版状态（key = slideId|aspect；内存态，不入 md/历史；全模式共享，
   *  由 useLayoutScan 静默探测写入，SlideView 各模式统一读取——编辑/胶片/放映/PDF 一致） */
  pageLayout: Record<string, SpacingState>;
  /** 块剪贴板（复制/粘贴按钮；内存态跨页跨工程有效，不入 md/历史） */
  clipBlock: Block | null;
  copyBlock(slideId: string, blockId: string): void;
  pasteBlockAfter(slideId: string, afterId: string | null): string | null;

  setConfig(patch: Partial<DeckConfig>): void;
  updateSlide(slideId: string, patch: Partial<Slide>): void;
  updateBlock(slideId: string, blockId: string, patch: Partial<Block>): void;
  insertBlock(slideId: string, afterId: string | null, type: BlockType, init?: Partial<Block>): string;
  deleteBlock(slideId: string, blockId: string): void;
  moveBlockBefore(slideId: string, blockId: string, beforeId: string | null): void;
  addSlide(layout: Layout, afterPage?: number): void;
  deleteSlide(slideId: string): void;
  duplicateSlide(slideId: string): void;
  addSectionBefore(slideId: string, title: string, level: 1 | 2 | 3): void;
  moveSlide(slideId: string, beforeId: string | null): void;
  renameSection(sectionId: string, title: string): void;
  jumpToRef(label: string): void;
  startPresent(): Promise<void>;
  endPresent(): void;
  presentAdvance(): void;
  presentSkip(): void;
  presentReverse(): void;
  insertColEnd(slideId: string, blockId: string): void;
  insertColRegion(slideId: string, afterId: string): string;
  setPageLayout(key: string, st: SpacingState): void;
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

  newProject(): void;
  openProject(): Promise<void>;
  loadProjectData(p: { md: string; folder: string }): void;
  loadExample(relPath: string): Promise<void>;
  saveProject(): Promise<void>;
  undo(): void;
  redo(): void;
}

function freshDeck(): Deck {
  return {
    config: { ...defaultConfig, palette: JSON.parse(JSON.stringify(defaultConfig.palette)) },
    items: [
      { kind: 'slide', slide: { id: newId(), layout: 'title', blocks: [] } },
      { kind: 'slide', slide: { id: newId(), layout: 'toc', blocks: [] } },
      { kind: 'slide', slide: { id: newId(), layout: 'content', title: '', blocks: [] } },
    ],
  };
}

export const useStore = create<StoreState>((set, get) => {
  /** 变更 deck 的统一入口：克隆 → 变更 → 重算编号/页 */
  const mutate = (fn: (d: Deck) => void, debounce = true) => {
    const s = get();
    const d: Deck = JSON.parse(JSON.stringify(s.deck));
    fn(d);
    recordHistory(s.deck, debounce);
    set({ deck: d, computed: computeDeck(d), dirty: true });
  };

  const initial = freshDeck();
  return {
    deck: initial,
    computed: computeDeck(initial),
    folder: null,
    current: 0,
    dirty: false,
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
    pageLayout: {},
    clipBlock: null,

    /** 复制块到剪贴板（内存态；粘贴时重新生成 id/剥除全局唯一字段） */
    copyBlock: (slideId, blockId) => {
      const s = get();
      const it = s.deck.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
      const b = it && it.kind === 'slide' ? it.slide.blocks.find((x) => x.id === blockId) : undefined;
      if (b) set({ clipBlock: JSON.parse(JSON.stringify(b)) });
    },

    /** 粘贴块：插到 afterId 之后（与 insertBlock 同锚点语义）。
     *  剥除 label（全 deck 唯一键，副本会静默劫持 [@fig:x] 引用——同 duplicateSlide）；
     *  剥除 pos（自由定位块粘贴会与原件完全重叠，回流式更可预期）。 */
    pasteBlockAfter: (slideId, afterId) => {
      const s = get();
      if (!s.clipBlock) return null;
      const id = newId();
      const { label: _l, pos: _p, ...rest } = s.clipBlock;
      const copy: Block = { ...JSON.parse(JSON.stringify(rest)), id };
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (!it || it.kind !== 'slide') return;
        const at = afterId ? it.slide.blocks.findIndex((x) => x.id === afterId) : -1;
        if (at >= 0) it.slide.blocks.splice(at + 1, 0, copy);
        else it.slide.blocks.push(copy);
      }, false);
      return id;
    },

    setConfig: (patch) => mutate((d) => { d.config = { ...d.config, ...patch }; }),

    updateSlide: (slideId, patch) =>
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (it && it.kind === 'slide') it.slide = { ...it.slide, ...patch };
      }),

    updateBlock: (slideId, blockId, patch) =>
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (!it || it.kind !== 'slide') return;
        const i = it.slide.blocks.findIndex((b) => b.id === blockId);
        if (i < 0) return;
        const prev = it.slide.blocks[i];
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
        if (patch.items && prev.itemOrders) {
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
            k < p ? prev.itemOrders![k]
              : k >= neu.length - sfx ? prev.itemOrders![oldItems.length - (neu.length - k)]
                : undefined
          ));
          patch = { ...patch, itemOrders: norm.some((o) => o != null) ? norm : undefined };
        }
        it.slide.blocks[i] = { ...prev, ...patch };
      }),

    insertBlock: (slideId, afterId, type, init) => {
      const id = newId();
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (!it || it.kind !== 'slide') return;
        const b: Block = { id, type, ...init };
        const at = afterId ? it.slide.blocks.findIndex((x) => x.id === afterId) : -1;
        if (at >= 0) it.slide.blocks.splice(at + 1, 0, b);
        else it.slide.blocks.push(b);
      }, false);
      return id;
    },

    deleteBlock: (slideId, blockId) =>
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (!it || it.kind !== 'slide') return;
        // 删块后顺手收回空栏区：删光栏内最后一块时自动移除残留的 colmark/colend
        //（否则双栏分割线与栏容器永远渲染——「删光元素意图退出双栏」的用户路径）
        it.slide.blocks = stripEmptyColRegions(it.slide.blocks.filter((b) => b.id !== blockId));
      }, false),

    /** 拖拽调序：把 blockId 移动到 beforeId 之前（beforeId=null 移到所在栏末尾）。
     *  栏安全：beforeId 必须与 blockId 同栏（colmark/colend 之间），否则忽略。 */
    moveBlockBefore: (slideId, blockId, beforeId) =>
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (!it || it.kind !== 'slide') return;
        const blocks = it.slide.blocks;
        const at = moveTargetOf(blocks, blockId, beforeId);
        if (at == null) return;
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
      mutate((d) => {
        d.items.splice(idx, 1);
        // 删页可能留下无页面归属的孤儿节标题（含链式），一并清理——
        // 否则残留小节会抢占其后新建章节的归属（用户实测报障）
        d.items = stripOrphanSections(d.items);
      }, false);
      // 清理该页的排版缓存孤儿键（防长会话「建页-删页」单调增长；undo 后重新扫描即可）
      set((st) => ({
        current: Math.min(st.current, Math.max(0, get().computed.pages.length - 1)),
        pageLayout: Object.fromEntries(Object.entries(st.pageLayout).filter(([k]) => !k.startsWith(slideId + '|'))),
      }));
    },

    duplicateSlide: (slideId) => {
      const s = get();
      const idx = d_indexOf(s.deck, slideId);
      if (idx < 0) return;
      const src = s.deck.items[idx];
      if (src.kind !== 'slide') return;
      const copy: Slide = JSON.parse(JSON.stringify(src.slide));
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

    /** 大纲拖拽换页序：把 slide 移到目标 slide 之前（beforeId=null 移到全 deck 末尾）。
     *  层级语义：slide 项在 items 数组里原位移动，节归属由 computeDeck 按
     *  前置 section 标题重算——移到某节标题之前即脱离该节，语义自然。
     *  禁区：不可移到 title/toc 之前（特殊页恒居首部）。 */
    moveSlide: (slideId: string, beforeId: string | null) => {
      const s = get();
      const from = d_indexOf(s.deck, slideId);
      if (from < 0) return;
      let to: number;
      if (beforeId == null) {
        to = s.deck.items.length;
      } else {
        const t = d_indexOf(s.deck, beforeId);
        if (t < 0 || t === from) return;
        to = t;
      }
      // 落点在 title/toc 特殊页之前 → 拒绝（保持特殊页恒居首部）
      const items = s.deck.items;
      const firstContent = items.findIndex((x) => x.kind === 'slide' && !['title', 'toc', 'end'].includes(x.slide.layout));
      if (firstContent > 0 && to < firstContent && from >= firstContent) return;
      mutate((d) => {
        const [it] = d.items.splice(from, 1);
        const at = from < to ? to - 1 : to;
        d.items.splice(at, 0, it);
      }, false);
      const c = get().computed;
      const idx = c.pages.findIndex((pg) => pg.kind === 'slide' && pg.slide?.id === slideId);
      if (idx >= 0) set({ current: idx });
    },

    renameSection: (sectionId, title) =>
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'section' && x.section.id === sectionId);
        if (it && it.kind === 'section') it.section.title = title;
      }),
    /** 结束双栏区：点击块逃出栏区成为首个单栏块（语义与开始双栏区对称）。
     *  落点/清理由 colEndPlan 纯函数决定——colend 插在点击块之前，
     *  旧 colend / 切栏标记按需删除，栏区清空则连开栏标记一起移除。 */
    insertColEnd: (slideId, blockId) => {
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (!it || it.kind !== 'slide') return;
        const plan = colEndPlan(it.slide.blocks, blockId);
        if (!plan) return;
        // 删除下标全部大于插入点（开栏标记只在「栏区清空不插入」分支删除），先删后插无需换算
        for (const i of [...plan.deleteIdx].sort((a, b) => b - a)) it.slide.blocks.splice(i, 1);
        if (plan.insertAt >= 0) it.slide.blocks.splice(plan.insertAt, 0, { id: newId(), type: 'colend' });
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
      mutate((d) => {
        const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
        if (!it || it.kind !== 'slide') return;
        const blocks = it.slide.blocks;
        const at = afterId ? blocks.findIndex((b) => b.id === afterId) : -1;
        const reg = at >= 0 ? colRegionAt(blocks, afterId) : null;
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
      const i = Math.max(0, Math.min(index, n - 1));
      set({
        current: i,
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
      set({ presenting: true, revealStep: 0, presentStart: Date.now(), editing: null, lightbox: null });
      await window.api.openPresent();
    },

    endPresent: () => {
      set({ presenting: false });
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
    setFocus: (id, pos = 'end') => set({ focusId: id, focusPos: pos }),
    setLightbox: (l) => set({ lightbox: l }),
    toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    setZoom: (z) => set({ zoom: Math.max(0.3, Math.min(3, z)) }),

    backJump: () => {
      const s = get();
      if (!s.jumpStack.length) return;
      const stack = [...s.jumpStack];
      const back = stack.pop()!;
      // 返回原处同理：若返回页不是高亮目标页，flash 一并失效
      set({ current: back, jumpStack: stack, flash: s.flash && s.flash.page !== back ? null : s.flash });
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
        if (cur && cur.s === st.s && cur.imgH === st.imgH && cur.fit === st.fit) return s;
        return { pageLayout: { ...s.pageLayout, [key]: st } };
      }),

    newProject: () => {
      clearHistory();
      attachHistoryFolder(null, '');
      const d = freshDeck();
      set({ deck: d, computed: computeDeck(d), folder: null, current: 0, dirty: false, pageLayout: {} });
    },

    openProject: async () => {
      const r = await window.api.openProject();
      if (!r || r.md == null) return;
      get().loadProjectData({ md: r.md, folder: r.folder });
    },

    loadProjectData: ({ md, folder }) => {
      clearHistory();
      try {
        const deck = parseMarkdown(md);
        recordHistory(deck);
        // 历史 adopt：读回该工程目录下的 .beamer-history.json 恢复撤销栈
        attachHistoryFolder(folder, JSON.stringify(deck));
        set({ deck, computed: computeDeck(deck), folder, current: 0, dirty: false, pageLayout: {} });
      } catch (e) {
        set({ flashMsg: '工程解析失败：' + String(e) });
      }
    },

    loadExample: async (relPath) => {
      const r = await window.api.loadExample(relPath);
      if (!r || r.md == null) {
        set({ flashMsg: '示例不存在：' + relPath });
        return;
      }
      get().loadProjectData({ md: r.md, folder: r.folder });
    },

    saveProject: async () => {
      const s = get();
      const md = serializeMarkdown(s.deck);
      const r = await window.api.saveProject({ folder: s.folder, md });
      if (r && r.folder) {
        // 首次另存到新文件夹：历史只改写入目标，不 adopt（防吃到别的工程的旧历史文件）
        if (s.folder !== r.folder) attachHistoryFolder(r.folder, JSON.stringify(s.deck), false);
        set({ folder: r.folder, dirty: false, flashMsg: '已保存 → ' + r.folder });
      } else if (r && r.error) {
        set({ flashMsg: '保存失败：' + r.error });
      }
    },

    undo: () => {
      const deck = takeUndo(get().deck);
      if (!deck) return;
      const computed = computeDeck(deck);
      set((s) => ({ deck, computed, dirty: true, current: Math.max(0, Math.min(s.current, computed.pages.length - 1)) }));
    },

    redo: () => {
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

/** 删除页后清理孤儿节标题：节标题到下一个 level≤自身 的节标题（或 items 末尾）
 *  之间没有任何内容页（content/twoCol；title/toc/end 特殊页不算归属）→ 该节已无
 *  页面引用，移除。含链式孤儿：章仅剩的页删掉后，章与其空小节一并移除
 *  （用户实测：删页后孤儿小节残留，其后新建章会被它抢占归属）。
 *  纯函数：无孤儿时原引用返回（避免无谓克隆）。 */
export function stripOrphanSections(items: DeckItem[]): DeckItem[] {
  const isContent = (it: DeckItem): boolean =>
    it.kind === 'slide' && (it.slide.layout === 'content' || it.slide.layout === 'twoCol');
  const orphan = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'section') continue;
    let has = false;
    for (let j = i + 1; j < items.length; j++) {
      const jt = items[j];
      if (jt.kind === 'section' && jt.section.level <= it.section.level) break;
      if (isContent(jt)) { has = true; break; }
    }
    if (!has) orphan.add(i);
  }
  return orphan.size ? items.filter((_, i) => !orphan.has(i)) : items;
}

function d_indexOfSection(deck: Deck, sectionId: string): number {
  return deck.items.findIndex((x) => x.kind === 'section' && x.section.id === sectionId);
}

/** 当前页对应的可编辑 slide（divider 页取其后第一张 slide；无则取其前；均无 null） */
export function editableSlideOf(page: Page | undefined, pages: Page[]): Slide | null {
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
export function pageOrders(page: { kind: string; slide?: { blocks: { order?: number; itemOrders?: (number | undefined)[] }[] } } | undefined): number[] {
  const orders: number[] = [];
  for (const b of page?.slide?.blocks || []) {
    if (b.order != null) orders.push(b.order);
    if (b.itemOrders) for (const o of b.itemOrders) if (o != null) orders.push(o);
  }
  return [...new Set(orders)].sort((a, b) => a - b);
}
