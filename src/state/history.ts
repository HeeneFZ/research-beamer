// Deck 快照撤销：100 轮上限，输入 500ms 防抖，工程历史 800ms 防抖落盘。
import { Deck } from '../model/types';
import { parseMarkdown, serializeMarkdown } from '../model/markdown';
import { annoFromJson } from '../model/anno';

const HISTORY_MAX = 100;
const PERSIST_DELAY = 800;
let undoStack: string[] = [];
let redoStack: string[] = [];
let pendingDeck: Deck | null = null;
let currentDeck: Deck | null = null;
let snapshotTimer: number | undefined;
let persistTimer: number | undefined;
let histFolder: string | null = null;
let loadingFile = false;
let loadTask: Promise<void> | null = null;
let retryLoad: (() => Promise<void>) | null = null;
let readFailed = false;
let needsPersist = false;
const pendingWrites = new Set<Promise<boolean>>();
let attachment = 0;
let edits = 0;

function pushStack(json: string): void {
  if (undoStack[undoStack.length - 1] === json) return;
  undoStack.push(json);
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
}

function flushPending(): void {
  clearTimeout(snapshotTimer);
  snapshotTimer = undefined;
  if (!pendingDeck) return;
  pushStack(JSON.stringify(pendingDeck));
  pendingDeck = null;
}

function reportFailure(error: unknown): void {
  console.warn('撤销历史保存/恢复失败：', error);
}

function persistNow(): boolean | Promise<boolean> {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const api = window.api;
  if (!histFolder || loadingFile || !api || api.isE2E) return true;
  // An unread existing file is not an empty history. Never overwrite it on read failure.
  if (readFailed) return false;
  flushPending();
  const json = JSON.stringify({
    current: currentDeck ? JSON.stringify(currentDeck) : null,
    undo: undoStack, redo: redoStack,
  });
  const generation = attachment, version = edits;
  const task = api.writeHistory({ folder: histFolder, json }).then((r) => {
    if (r?.error) { reportFailure(r.error); return false; }
    if (generation === attachment && version === edits) needsPersist = false;
    return true;
  }).catch((error) => { reportFailure(error); return false; });
  pendingWrites.add(task);
  void task.then(() => pendingWrites.delete(task));
  return task;
}

/** Preserve the debounced final undo point before the renderer or project leaves. */
export function flushHistory(): boolean | Promise<boolean> {
  const api = window.api;
  const generation = attachment;
  if (!histFolder || !api || api.isE2E) return true;
  if (!needsPersist && !pendingDeck && persistTimer == null && !loadTask && !readFailed && !pendingWrites.size) return true;
  return (async () => {
    if (readFailed && !loadTask) retryLoad?.();
    if (loadTask) await loadTask;
    if (generation !== attachment || readFailed) return false;
    const write = persistNow();
    const results = await Promise.all([...pendingWrites, write]);
    return generation === attachment && results.every(Boolean);
  })();
}

function schedulePersist(): void {
  if (!histFolder) return;
  needsPersist = true;
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistNow, PERSIST_DELAY);
}

/** deck 必须不可变；防抖窗口内只挂最新 pre-state，落栈时再序列化。 */
export function recordHistory(deck: Deck, debounce = false, after: Deck = deck): void {
  edits++;
  currentDeck = after;
  redoStack = [];
  clearTimeout(snapshotTimer);
  if (debounce) {
    pendingDeck = deck;
    snapshotTimer = window.setTimeout(() => {
      flushPending();
      schedulePersist();
    }, 500);
  } else {
    // 结构操作紧跟输入时保留输入的撤销点，随后再记录结构操作前态。
    flushPending();
    pushStack(JSON.stringify(deck));
  }
  schedulePersist();
}

export function clearHistory(): void {
  flushPending();
  if (needsPersist) void persistNow();
  clearTimeout(persistTimer);
  persistTimer = undefined;
  attachment++;
  edits++;
  loadingFile = false;
  loadTask = null;
  retryLoad = null;
  readFailed = false;
  needsPersist = false;
  undoStack = [];
  redoStack = [];
  currentDeck = null;
}

/** 用 Markdown 内容比较快照，忽略每次解析重新生成的 slide/block/section IDs。
 *  再解析一遍同时对齐旧配色等兼容迁移；损坏快照不能进入可执行的撤销栈。 */
function normalizedSnapshot(json: unknown): { content: string; json: string } | null {
  if (typeof json !== 'string') return null;
  try {
    const deck = JSON.parse(json) as Deck;
    if (!deck.config || !Array.isArray(deck.items)) return null;
    if (deck.config.aspect !== '16:9' && deck.config.aspect !== '4:3') return null;
    // Serialization can silently stringify malformed fields. Validate their runtime
    // types before accepting an external snapshot; keep valid IDs and empty blocks.
    const text = (value: unknown) => value == null || typeof value === 'string';
    const numeric = (value: unknown) => value == null || typeof value === 'number' && Number.isFinite(value);
    const order = (value: unknown) => value == null || typeof value === 'number' && Number.isInteger(value) && value >= 1;
    for (const item of deck.items) {
      if (item.kind === 'section') {
        if (!item.section || typeof item.section.id !== 'string' || !item.section.id || ![1, 2, 3].includes(item.section.level) || typeof item.section.title !== 'string' || !text(item.section.label)) return null;
      } else if (item.kind === 'slide') {
        const slide = item.slide;
        if (!slide || typeof slide.id !== 'string' || !slide.id || !['title', 'toc', 'section', 'content', 'twoCol', 'end'].includes(slide.layout) || !Array.isArray(slide.blocks)) return null;
        if (![slide.title, slide.footNote, slide.notes].every(text) || ![slide.ratio, slide.fontScale].every(numeric)) return null;
        if (slide.ratio != null && !(slide.ratio > 0 && slide.ratio < 1)) return null;
        for (const block of slide.blocks) {
          if (!block || typeof block.id !== 'string' || !block.id || !['paragraph', 'itemize', 'equation', 'annoeq', 'figure', 'video', 'table', 'colmark', 'colend'].includes(block.type)) return null;
          if (![block.text, block.latex, block.label, block.src, block.caption].every(text) || !numeric(block.width) || !order(block.order)) return null;
          if (block.width != null && !(block.width > 0 && block.width <= 1)) return null;
          if (block.items != null && (!Array.isArray(block.items) || !block.items.every((value) => typeof value === 'string'))) return null;
          if (block.cells != null && (!Array.isArray(block.cells) || !block.cells.every((row) => Array.isArray(row) && row.every((value) => typeof value === 'string')))) return null;
          if (block.itemOrders != null && (!Array.isArray(block.itemOrders) || !block.itemOrders.every(order))) return null;
          if (block.pos != null && ![block.pos.x, block.pos.y, block.pos.w].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
        }
      } else return null;
    }
    const canonical = parseMarkdown(serializeMarkdown(deck));
    // Preserve the IDs and empty editing blocks that Markdown does not store.
    // External annotation JSON must pass the same normalization as deck.md.
    deck.config = canonical.config;
    for (const item of deck.items) if (item.kind === 'slide') {
      for (const block of item.slide.blocks) if (block.type === 'annoeq') block.anno = annoFromJson(JSON.stringify(block.anno));
    }
    return { content: serializeMarkdown(canonical), json: JSON.stringify(deck) };
  } catch {
    return null;
  }
}

export function attachHistoryFolder(folder: string | null, baseJson: string, adopt = true): void {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const generation = ++attachment;
  const version = edits;
  histFolder = folder;
  loadingFile = false;
  loadTask = null;
  retryLoad = null;
  readFailed = false;
  needsPersist = false;
  if (!folder) return;
  if (!currentDeck) currentDeck = JSON.parse(baseJson) as Deck;
  const api = window.api;
  if (!api || api.isE2E) return;
  if (!adopt) { schedulePersist(); return; }
  const readDisk = () => {
    loadingFile = true;
    const task = api.readHistory(folder).then((r) => {
      if (generation !== attachment) return;
      if (r?.error) throw new Error(r.error);
      loadingFile = false;
      readFailed = false;
      retryLoad = null;
      if (r?.json) {
        try {
          const parsed = JSON.parse(r.json) as { current?: unknown; undo?: unknown[]; redo?: unknown[] };
          if (Array.isArray(parsed.undo) && Array.isArray(parsed.redo)) {
            const read = (values: unknown[]) => values.slice(-HISTORY_MAX).map(normalizedSnapshot)
              .filter((value): value is NonNullable<ReturnType<typeof normalizedSnapshot>> => value != null);
            const file = read(parsed.undo);
            const base = normalizedSnapshot(baseJson);
            const matchesSaved = !!base && normalizedSnapshot(parsed.current)?.content === base.content;
            // deck.md 已保存态之后的快照属于未保存的未来，不能在重开时作为撤销点。
            let cut = -1;
            for (let i = file.length - 1; i >= 0; i--) {
              if (file[i].content === base?.content) { cut = i; break; }
            }
            // Older versions stored only undo/redo, without a saved-current marker.
            const legacy = !Object.prototype.hasOwnProperty.call(parsed, 'current');
            const loaded = (matchesSaved || legacy ? file : cut >= 0 ? file.slice(0, cut) : []).map((value) => value.json);
            if (edits === version) {
              undoStack = loaded;
              redoStack = matchesSaved || legacy ? read(parsed.redo).map((value) => value.json) : [];
            } else {
              flushPending();
              // Local edits start at deck.md. Keep their current/redo branch and join
              // older disk undo states before it, including the saved baseline bridge.
              const first = undoStack[0] ?? (currentDeck ? JSON.stringify(currentDeck) : baseJson);
              const firstContent = normalizedSnapshot(first)?.content;
              if (base && firstContent !== base.content) loaded.push(base.json);
              if (loaded.length && undoStack.length && normalizedSnapshot(loaded[loaded.length - 1])?.content === firstContent) loaded.pop();
              undoStack = [...loaded, ...undoStack].slice(-HISTORY_MAX);
            }
          }
        } catch (error) { reportFailure(error); }
      }
      schedulePersist();
    }).catch((error) => {
      if (generation !== attachment) return;
      loadingFile = false;
      readFailed = true;
      reportFailure(error);
      schedulePersist();
    });
    loadTask = task;
    void task.then(() => { if (loadTask === task) loadTask = null; });
    return task;
  };
  retryLoad = readDisk;
  void readDisk();
}

export function takeUndo(current: Deck): Deck | null {
  flushPending();
  if (!undoStack.length) return null;
  edits++;
  redoStack.push(JSON.stringify(current));
  if (redoStack.length > HISTORY_MAX) redoStack.shift();
  currentDeck = JSON.parse(undoStack.pop()!) as Deck;
  schedulePersist();
  return currentDeck;
}

export function takeRedo(current: Deck): Deck | null {
  flushPending();
  if (!redoStack.length) return null;
  edits++;
  pushStack(JSON.stringify(current));
  currentDeck = JSON.parse(redoStack.pop()!) as Deck;
  schedulePersist();
  return currentDeck;
}

export function historyDepth(): number {
  return undoStack.length + redoStack.length;
}
