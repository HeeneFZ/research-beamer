// 段式双栏布局：块序列按 colmark/colend 标记切成 单栏段/双栏段

import { Block } from './types';

/** 段式布局：colmark 开双栏（第二个切右栏），colend 收栏回单栏 */
interface ColRegion {
  kind: 'cols';
  left: Block[];
  right: Block[];
  switched: boolean;
}
interface FullRegion {
  kind: 'full';
  blocks: Block[];
}
export type Segment = FullRegion | ColRegion;

export function buildSegments(blocks: Block[]): Segment[] {
  const segs: Segment[] = [];
  let full: FullRegion = { kind: 'full', blocks: [] };
  let cols: ColRegion | null = null;
  const flushFull = () => {
    if (full.blocks.length) segs.push(full);
    full = { kind: 'full', blocks: [] };
  };
  for (const b of blocks) {
    if (b.type === 'colmark') {
      if (!cols) {
        flushFull();
        cols = { kind: 'cols', left: [], right: [], switched: false };
      } else if (cols.switched) {
        segs.push(cols);
        cols = { kind: 'cols', left: [], right: [], switched: false };
      } else {
        cols.switched = true;
      }
      continue;
    }
    if (b.type === 'colend') {
      if (cols) {
        segs.push(cols);
        cols = null;
      }
      continue;
    }
    if (cols) {
      if (cols.switched) cols.right.push(b);
      else cols.left.push(b);
    } else {
      full.blocks.push(b);
    }
  }
  if (cols) segs.push(cols);
  flushFull();
  return segs;
}
