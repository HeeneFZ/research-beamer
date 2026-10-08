// SlideView 公共类型：渲染模式 + 组件入参（编辑画布/缩略胶片/放映/PDF 导出共用）

import { Deck, Page } from '../../model/types';
import { Computed } from '../../model/numbering';

export type SlideMode = 'edit' | 'thumb' | 'preview' | 'present' | 'print';

export interface SlideViewProps {
  page: Page;
  deck: Deck;
  computed: Computed;
  folder: string;
  mode?: SlideMode;
  revealed?: Set<number>;
  onRef?: (label: string) => void;
  onSlideJump?: (pageIndex: number) => void;
  highlightLabel?: string;
  onZoom?: (abs: string, ext: string, caption?: string) => void;
}
