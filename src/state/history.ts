// 撤销/重做：deck 的 JSON 快照栈。
// - 深度上限 HISTORY_MAX（默认 100 轮，超出丢最旧）
// - 输入防抖 500ms 合并连续击键
// - 持久化：快照写入工程目录 .beamer-history.json（隐藏文件），重开工程可继续撤销；
//   持久化自带 800ms 防抖，E2E 模式禁用（不污染示例副本）
// 旧快照（关窗未保存）在重开时按「deck.md 基态在栈中最深出现位」截断——
// 撤销方向恒为时间回退，不会跳到未保存的更新状态。

import { Deck } from '../model/types';

const HISTORY_MAX = 100;
const PERSIST_DELAY = 800;

let undoStack: string[] = [];
let redoStack: string[] = [];
let snapshotTimer: number | undefined;
// 防抖挂起的快照（500ms 窗口内未落栈）。undo/redo/clear 必须先同步冲刷：
// 否则窗口期内的撤销会弹出更早的快照（一次回跳两步），且挂起快照随后
// 落栈时清空 redoStack，把刚压入的重做状态销毁（竞态已实测复现）。
let pendingJson: string | null = null;
// 历史持久化目录（当前工程文件夹）；null = 未绑定（新工程未保存），只在内存
let histFolder: string | null = null;
let persistTimer: number | undefined;
// 工程切换时异步读回历史文件的窗口期标记：期间不落盘（防旧工程文件被覆盖）
let loadingFile = false;

function pushStack(json: string): void {
  if (undoStack[undoStack.length - 1] !== json) {
    undoStack.push(json);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
  }
}

/** 挂起的防抖快照立即落栈 */
function flushPending(): void {
  if (pendingJson == null) return;
  clearTimeout(snapshotTimer);
  const json = pendingJson;
  pendingJson = null;
  pushStack(json);
}

function persistNow(): void {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const api = (window as unknown as { api?: { writeHistory(p: { folder: string; json: string }): Promise<unknown>; isE2E: boolean } }).api;
  if (!histFolder || loadingFile || !api || api.isE2E) return;
  void api.writeHistory({ folder: histFolder, json: JSON.stringify({ undo: undoStack, redo: redoStack }) }).catch(() => { /* 磁盘失败不阻塞编辑 */ });
}

function schedulePersist(): void {
  if (!histFolder) return;
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistNow, PERSIST_DELAY);
}

export function recordHistory(deck: Deck, debounce = false): void {
  clearTimeout(snapshotTimer);
  const json = JSON.stringify(deck);
  // 任何真实编辑都立即使重做失效（不能等防抖落栈——窗口期内的 redo 会恢复
  // 已被编辑作废的状态；且快照去重（与栈顶相同不入栈）不能跳过该清理）
  redoStack = [];
  if (debounce) {
    pendingJson = json;
    snapshotTimer = window.setTimeout(() => {
      pendingJson = null;
      pushStack(json);
      schedulePersist();
    }, 500);
  } else {
    pendingJson = null;
    pushStack(json);
  }
  schedulePersist();
}

export function clearHistory(): void {
  clearTimeout(snapshotTimer);
  pendingJson = null;
  undoStack = [];
  redoStack = [];
}

/** 绑定/切换历史持久化目录。adopt=true（打开工程）时异步读回快照恢复撤销栈；
 *  adopt=false（首次另存到新文件夹）只设写入目标不读回（防止吃到别的工程的旧文件）。
 *  baseJson = 本次加载的 deck 序列化（截断锚点，见文件头注释）。 */
export function attachHistoryFolder(folder: string | null, baseJson: string, adopt = true): void {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  histFolder = folder;
  if (!folder) return;
  const api = (window as unknown as { api?: { readHistory(f: string): Promise<{ json?: string } | { error: string } | null>; isE2E: boolean } }).api;
  if (!api || api.isE2E || !adopt) return;
  loadingFile = true;
  void api.readHistory(folder).then((r) => {
    loadingFile = false;
    if (!r || !('json' in r) || !r.json) { schedulePersist(); return; }
    // 竞态守卫：读回完成前用户已产生新编辑（栈不再只有加载基态）→ 文件已过期，内存为准
    if (undoStack.length > 1 || (undoStack.length === 1 && undoStack[0] !== baseJson)) { schedulePersist(); return; }
    try {
      const parsed = JSON.parse(r.json) as { undo?: unknown[]; redo?: unknown[] };
      if (Array.isArray(parsed.undo) && Array.isArray(parsed.redo)) {
        const file = parsed.undo.filter((x): x is string => typeof x === 'string');
        // 截断：deck.md 基态在栈中最深出现位之后的快照是「关窗时未保存的更新状态」，
        // 保留会让撤销跳向未来；找不到（外部手改/正常保存关闭）则全量保留
        let cut = -1;
        for (let i = file.length - 1; i >= 0; i--) if (file[i] === baseJson) { cut = i; break; }
        undoStack = (cut >= 0 ? file.slice(0, cut + 1) : file).slice(-HISTORY_MAX);
        redoStack = parsed.redo.filter((x): x is string => typeof x === 'string').slice(-HISTORY_MAX);
        if (undoStack[undoStack.length - 1] !== baseJson) undoStack.push(baseJson);
      }
    } catch { /* 历史文件损坏：弃用，保持内存态 */ }
    schedulePersist();
  }).catch(() => { loadingFile = false; });
}

/** 弹出上一快照；current 压入重做栈。无快照返回 null */
export function takeUndo(current: Deck): Deck | null {
  flushPending();
  if (!undoStack.length) return null;
  const snap = undoStack.pop()!;
  redoStack.push(JSON.stringify(current));
  if (redoStack.length > HISTORY_MAX) redoStack.shift();
  schedulePersist();
  return JSON.parse(snap) as Deck;
}

/** 弹出下一快照；current 压入撤销栈。无快照返回 null */
export function takeRedo(current: Deck): Deck | null {
  flushPending();
  if (!redoStack.length) return null;
  const snap = redoStack.pop()!;
  undoStack.push(JSON.stringify(current));
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  schedulePersist();
  return JSON.parse(snap) as Deck;
}

/** 测试钩子：当前栈深（undo+redo） */
export function historyDepth(): number {
  return undoStack.length + redoStack.length;
}
