import type { Block, Deck, DeckItem, Page, Slide } from './types';
import type { Computed } from './numbering';
import { serializeMarkdown } from './markdown';

// Deck models are immutable; cache canonical keys across external revisions.
const keys = new WeakMap<object, string>();
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}
function blockKey(block: Block): string {
  let key = keys.get(block);
  if (key == null) { const { id, ...data } = block; key = stable(data); keys.set(block, key); }
  return key;
}
function itemKey(item: DeckItem): string {
  let key = keys.get(item);
  if (key == null) {
    if (item.kind === 'section') { const { id, ...data } = item.section; key = stable(['section', data]); }
    else { const { id, blocks, ...data } = item.slide; key = stable(['slide', data, blocks.map(blockKey)]); }
    keys.set(item, key);
  }
  return key;
}
function configKey(config: Deck['config']): string {
  let key = keys.get(config);
  if (key == null) { key = serializeMarkdown({ config, items: [] }); keys.set(config, key); }
  return key;
}
function match<T>(before: T[], after: T[], exact: (item: T) => string, semantic: (item: T) => string, kind: (item: T) => string): number[] {
  const result = after.map(() => -1), used = new Set<number>();
  for (const keyOf of [exact, semantic]) {
    const buckets = new Map<string, { indices: number[]; cursor: number }>();
    before.forEach((item, index) => {
      if (used.has(index)) return;
      const key = keyOf(item); if (!key) return;
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { indices: [], cursor: 0 }; buckets.set(key, bucket); }
      bucket.indices.push(index);
    });
    after.forEach((item, index) => {
      if (result[index] >= 0) return;
      const bucket = buckets.get(keyOf(item)), previous = bucket?.indices[bucket.cursor];
      if (bucket && previous != null) { bucket.cursor++; result[index] = previous; used.add(previous); }
    });
  }
  const old = before.map((_, index) => index).filter((index) => !used.has(index));
  const next = after.map((_, index) => index).filter((index) => result[index] < 0);
  if (old.length === next.length) next.forEach((index, offset) => { if (kind(before[old[offset]]) === kind(after[index])) result[index] = old[offset]; });
  return result;
}
function reconcileSlide(before: Slide, after: Slide): Slide {
  const matches = match(before.blocks, after.blocks, blockKey, (block) => block.label ? `${block.type}:${block.label}` : '', (block) => block.type);
  const blocks = after.blocks.map((block, index) => {
    const previous = before.blocks[matches[index]];
    return !previous ? block : blockKey(previous) === blockKey(block) ? previous : { ...block, id: previous.id };
  });
  return { ...after, id: before.id, blocks };
}
export function reconcileDeck(before: Deck, after: Deck): Deck {
  const matches = match(before.items, after.items, itemKey, (item) => item.kind === 'section'
    ? `section:${item.section.level}:${item.section.label ?? item.section.title}`
    : item.slide.title ? `slide:${item.slide.layout}:${item.slide.title}` : '',
  (item) => item.kind === 'section' ? `section:${item.section.level}` : `slide:${item.slide.layout}`);
  const items = after.items.map((item, index): DeckItem => {
    const previous = before.items[matches[index]];
    if (!previous) return item;
    if (itemKey(previous) === itemKey(item)) return previous;
    if (previous.kind === 'section' && item.kind === 'section') return { kind: 'section', section: { ...item.section, id: previous.section.id } };
    if (previous.kind === 'slide' && item.kind === 'slide') return { kind: 'slide', slide: reconcileSlide(previous.slide, item.slide) };
    return item;
  });
  const config = configKey(before.config) === configKey(after.config) ? before.config : after.config;
  return config === before.config && items.length === before.items.length && items.every((item, index) => item === before.items[index])
    ? before : { config, items };
}
export const pageIdentity = (page: Page) => page.kind === 'slide' ? `slide:${page.slide?.id}` : `divider:${page.section?.id}`;
export function reuseComputedPages(before: Computed, after: Computed): Computed {
  const previous = new Map(before.pages.map((page) => [pageIdentity(page), page]));
  const maps = Object.entries(after).filter(([key]) => key !== 'pages');
  const sameMaps = maps.every(([key, next]) => {
    const old = Reflect.get(before, key);
    return old instanceof Map && next instanceof Map && old.size === next.size
      && [...next].every(([label, value]) => old.has(label) && old.get(label) === value);
  });
  return { ...after, ...(sameMaps ? Object.fromEntries(maps.map(([key]) => [key, Reflect.get(before, key)])) : {}), pages: after.pages.map((page) => {
    const old = previous.get(pageIdentity(page));
    return old && old.index === page.index && old.no === page.no && old.slide === page.slide && old.section === page.section
      && old.sectionPath.length === page.sectionPath.length && old.sectionPath.every((section, index) => section === page.sectionPath[index]) ? old : page;
  }) };
}
