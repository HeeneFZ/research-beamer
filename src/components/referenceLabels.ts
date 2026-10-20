import { useStore, slideOf } from '../state/store';
import { normLabel } from '../model/markdown';
import { promptText } from './prompt';

/** Shared text/list target editor; asynchronous prompts stay in their project. */
export async function editReferenceLabel(slideId: string, blockId: string, itemIndex?: number): Promise<void> {
  const initial = useStore.getState();
  const block = slideOf(initial.deck, slideId)?.blocks.find((b) => b.id === blockId);
  if (!block) return;
  const value = await promptText('引用标签（如 abc，引用显示为 [abc]；留空清除）',
    ((itemIndex == null ? block.label : block.itemLabels?.[itemIndex]) ?? '').replace(/^ref:/, ''));
  const state = useStore.getState();
  if (value == null || state.mediaRevision !== initial.mediaRevision || state.projectExiting) return;
  const current = slideOf(state.deck, slideId)?.blocks.find((b) => b.id === blockId);
  if (!current || itemIndex != null && (current.items !== block.items || itemIndex >= (current.items?.length ?? 0))) return;
  const label = value.trim() ? normLabel('ref', value.trim()) : undefined;
  if (label && !/^ref:[\w-]+$/.test(label)) { state.setFlashMsg('标签只支持字母、数字、下划线和连字符（ref:名称）'); return; }
  if (label && state.deck.items.some((item) => item.kind === 'slide' && item.slide.blocks.some((b) =>
    (b.id !== blockId || itemIndex != null) && b.label === label
      || b.itemLabels?.some((target, i) => target === label && (b.id !== blockId || i !== itemIndex))))) {
    state.setFlashMsg('引用标签已存在：' + label);
    return;
  }
  if (itemIndex == null) state.updateBlock(slideId, blockId, { label });
  else {
    const itemLabels = Array.from({ length: current.items!.length }, (_, i) => i === itemIndex ? label : current.itemLabels?.[i]);
    state.updateBlock(slideId, blockId, { itemLabels: itemLabels.some(Boolean) ? itemLabels : undefined });
  }
}
