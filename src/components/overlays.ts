// 浮层豁免清单：所有 portal 到 body（或覆盖在画布上）的交互层。
// 用途：React portal 的事件沿 React 树冒泡，但 DOM 上不在 .page-wrap 内——
// 「点击空白退出编辑」「返回键守卫」等 DOM 判断必须用此清单豁免浮层，
// 否则弹窗/菜单内点击会被误判为画布空白点击（第十轮 Bug：点公式弹窗即关）。

/** 命中任意浮层（含页面外 portal）返回 true */
export const OVERLAY_SELECTOR =
  '.modal-mask, .lb-overlay, .ref-picker, .slash-menu, .btools-float, .btools-menu-float, .math-float, .strip-menu, .ctx, .menu-drop, .sec-menu, .field-popover, .bubble-bar';

export function onOverlay(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest(OVERLAY_SELECTOR);
}
