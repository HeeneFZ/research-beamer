// 撤销/重做：deck 的 JSON 快照栈（上限 200，输入防抖 500ms 合并连续击键）

import { Deck } from '../model/types';

let undoStack: string[] = [];
let redoStack: string[] = [];
let snapshotTimer: number | undefined;
// 防抖挂起的快照（500ms 窗口内未落栈）。undo/redo/clear 必须先同步冲刷：
// 否则窗口期内的撤销会弹出更早的快照（一次回跳两步），且挂起快照随后
// 落栈时清空 redoStack，把刚压入的重做状态销毁（竞态已实测复现）。
let pendingJson: string | null = null;

function pushStack(json: string): void {
  if (undoStack[undoStack.length - 1] !== json) {
    undoStack.push(json);
    if (undoStack.length > 200) undoStack.shift();
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
    }, 500);
  } else {
    pendingJson = null;
    pushStack(json);
  }
}

export function clearHistory(): void {
  clearTimeout(snapshotTimer);
  pendingJson = null;
  undoStack = [];
  redoStack = [];
}

/** 弹出上一快照；current 压入重做栈。无快照返回 null */
export function takeUndo(current: Deck): Deck | null {
  flushPending();
  if (!undoStack.length) return null;
  const snap = undoStack.pop()!;
  redoStack.push(JSON.stringify(current));
  return JSON.parse(snap) as Deck;
}

/** 弹出下一快照；current 压入撤销栈。无快照返回 null */
export function takeRedo(current: Deck): Deck | null {
  flushPending();
  if (!redoStack.length) return null;
  const snap = redoStack.pop()!;
  undoStack.push(JSON.stringify(current));
  return JSON.parse(snap) as Deck;
}
