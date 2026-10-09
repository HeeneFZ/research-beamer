// Cache for the largest connected display, so changing monitors does not decode again.
export const SCREEN_SAMPLING = 1.5;
let target: Promise<number> | null = null;
export function displayPagePixels(): Promise<number> {
  return target ??= window.api.displayTargets().then((displays) => Math.max(...displays.map((display) =>
    Math.min(display.width, display.height * 16 / 9) * display.scaleFactor)));
}
