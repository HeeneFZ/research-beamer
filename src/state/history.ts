// Deck 快照撤销：100 轮上限，输入 500ms 防抖，工程历史 800ms 防抖落盘。
import { Deck } from '../model/types';
import { parseMarkdown, serializeMarkdown } from '../model/markdown';

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

function persistNow(): void {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const api = window.api;
  if (!histFolder || loadingFile || !api || api.isE2E) return;
  flushPending();
  const json = JSON.stringify({
    current: currentDeck ? JSON.stringify(currentDeck) : null,
    undo: undoStack, redo: redoStack,
  });
  void api.writeHistory({ folder: histFolder, json }).then((r) => {
    if (r?.error) reportFailure(r.error);
  }).catch(reportFailure);
}

function schedulePersist(): void {
  if (!histFolder) return;
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
  persistNow();
  attachment++;
  edits++;
  loadingFile = false;
  undoStack = [];
  redoStack = [];
  currentDeck = null;
}

/** 用 Markdown 内容比较快照，忽略每次解析重新生成的 slide/block/section IDs。
 *  再解析一遍同时对齐旧配色等兼容迁移；损坏快照不能进入可执行的撤销栈。 */
function snapshotContent(json: unknown): string | null {
  if (typeof json !== 'string') return null;
  try {
    const deck = JSON.parse(json) as Deck;
    if (!deck.config || !Array.isArray(deck.items)) return null;
    if (deck.config.aspect !== '16:9' && deck.config.aspect !== '4:3') return null;
    return serializeMarkdown(parseMarkdown(serializeMarkdown(deck)));
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
  if (!folder) return;
  if (!currentDeck) currentDeck = JSON.parse(baseJson) as Deck;
  const api = window.api;
  if (!api || api.isE2E) return;
  if (!adopt) { schedulePersist(); return; }
  loadingFile = true;
  void api.readHistory(folder).then((r) => {
    if (generation !== attachment) return;
    loadingFile = false;
    if (edits !== version) { schedulePersist(); return; }
    if (r?.error) reportFailure(r.error);
    if (r?.json) {
      try {
        const parsed = JSON.parse(r.json) as { current?: unknown; undo?: unknown[]; redo?: unknown[] };
        if (Array.isArray(parsed.undo) && Array.isArray(parsed.redo)) {
          const contents = new Map<string, string>();
          const valid = (value: unknown): value is string => {
            const content = snapshotContent(value);
            if (typeof value !== 'string' || content == null) return false;
            contents.set(value, content);
            return true;
          };
          const file = parsed.undo.slice(-HISTORY_MAX).filter(valid);
          const base = snapshotContent(baseJson);
          const matchesSaved = snapshotContent(parsed.current) === base;
          // deck.md 已保存态之后的快照属于未保存的未来，不能在重开时作为撤销点。
          let cut = -1;
          for (let i = file.length - 1; i >= 0; i--) {
            if (contents.get(file[i]) === base) { cut = i; break; }
          }
          undoStack = matchesSaved ? file : cut >= 0 ? file.slice(0, cut) : file;
          redoStack = matchesSaved
            ? parsed.redo.slice(-HISTORY_MAX).filter(valid) : [];
        }
      } catch (error) { reportFailure(error); }
    }
    schedulePersist();
  }).catch((error) => {
    if (generation !== attachment) return;
    loadingFile = false;
    reportFailure(error);
    schedulePersist();
  });
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
