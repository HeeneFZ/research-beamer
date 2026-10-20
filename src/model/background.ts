import type { Pos } from './types';

export function clampBackgroundPos(pos: Pos): Pos {
  const round = (value: number) => Math.abs(value) <= Number.MAX_SAFE_INTEGER / 10 ? Math.round(value * 10) / 10 : value;
  return {
    x: round(pos.x),
    y: round(pos.y),
    w: round(Math.max(1, pos.w)),
  };
}

/** Preserve the source's aspect ratio while filling the page, centred initially. */
export function defaultBackgroundPos(pageAspect: number, imageAspect: number): Pos {
  const w = Math.max(100, 100 * imageAspect / pageAspect);
  const h = w * pageAspect / imageAspect;
  return { x: (100 - w) / 2, y: (100 - h) / 2, w };
}
