// 块插入项与统一分发 —— 块工具栏 ＋ 菜单、空页首块菜单、斜杠菜单三入口的唯一事实源。
// 原本三份近似列表 + 三份 init/分发逻辑已经漂移过一次（key 命名 block-eq vs equation），
// 新增块类型或改默认载荷只改这里。

import { useStore } from '../state/store';
import { insertMediaBlock } from './BlockEditors';
import { defaultAnnoState } from '../model/anno';
import { Block } from '../model/types';

export const INSERT_ITEMS = [
  { key: 'paragraph', badge: '¶', cls: 'sec', label: '段落', hint: '文本' },
  { key: 'itemize', badge: '≡', cls: 'eq', label: '列表', hint: '要点' },
  { key: 'equation', badge: '∑', cls: 'eq', label: '公式', hint: '编号' },
  { key: 'annoeq', badge: '⌖', cls: 'eq', label: '注释公式', hint: '引线标注' },
  { key: 'figure', badge: '▣', cls: 'fig', label: '图片…', hint: '文件' },
  { key: 'video', badge: '▶', cls: 'fig', label: '视频…', hint: '文件' },
  { key: 'table', badge: '▦', cls: 'tab', label: '表格', hint: '三线表' },
  { key: 'colmark', badge: '◫', cls: 'cite', label: '开始双栏区', hint: '左右两栏' },
  { key: 'colend', badge: '▪', cls: 'cite', label: '结束双栏区', hint: '回单栏' },
] as const;

export type InsertKey = typeof INSERT_ITEMS[number]['key'];

/** 统一插入分发（afterId=null 追加到页尾）：
 *  - figure/video → 文件选择对话框（媒体复制进工程）
 *  - colmark → 原子开栏（colmark+左右空段），光标落左栏
 *  - colend → 收栏（点击块逃出栏区；须在栏区内，调用方负责 disable）
 *  - 文本块 → 插入即进编辑（setFocus 桥）；其余 → 进属性面板（setEditing）
 *  返回新块 id；媒体/收栏路径无返回值。 */
export function insertBlockByKey(slideId: string, afterId: string | null, key: InsertKey): string | undefined {
  const s = useStore.getState();
  if (key === 'figure' || key === 'video') {
    void insertMediaBlock(slideId, afterId, key);
    return undefined;
  }
  if (key === 'colmark') {
    const leftId = s.insertColRegion(slideId, afterId);
    s.setFocus(leftId, 'start');
    return leftId;
  }
  if (key === 'colend') {
    if (afterId != null) s.insertColEnd(slideId, afterId);
    return undefined;
  }
  const init: Partial<Block> =
    key === 'equation' ? { latex: 'x = 1' } :
    key === 'annoeq' ? { latex: 'x = 1', anno: defaultAnnoState() } :
    key === 'itemize' ? { items: ['条目'] } :
    key === 'table' ? { cells: [['列1', '列2'], ['', '']] } :
    { text: '' };
  const id = s.insertBlock(slideId, afterId, key as Block['type'], init);
  if (key === 'paragraph' || key === 'itemize') s.setFocus(id, 'start');
  else s.setEditing({ slideId, blockId: id });
  return id;
}
