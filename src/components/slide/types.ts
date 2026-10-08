// SlideView 公共类型：渲染模式 + 组件入参（编辑画布/缩略胶片/放映/PDF 导出共用）

import { Deck, Page } from '../../model/types';
import { Computed } from '../../model/numbering';
import { PageLayout } from '../../model/layoutSpec';
import { MediaPreparation } from '../../model/mediaResources';

export type SlideMode = 'edit' | 'thumb' | 'preview' | 'present' | 'print';

export interface SlideViewProps {
  page: Page;
  deck: Deck;
  computed: Computed;
  folder: string;
  mode?: SlideMode;
  /** Only the editor's static filmstrip owns layout calculation. Other views consume it. */
  layoutAuthority?: boolean;
  /** PDF captures content and its finalized layout together, even if editing continues. */
  layoutSnapshot?: Record<string, PageLayout>;
  mediaSnapshot?: number;
  resourceSnapshot?: MediaPreparation;
  revealed?: Set<number>;
  onRef?: (label: string) => void;
  onSlideJump?: (pageIndex: number) => void;
  highlightLabel?: string;
  onZoom?: (abs: string, ext: string, caption?: string) => void;
  /** A stage owns the handoff/progress UI when provided. */
  onReady?: (ready: boolean) => void;
  /** Only the displayed page may play video; warmed pages retain their first frame. */
  mediaActive?: boolean;
}
