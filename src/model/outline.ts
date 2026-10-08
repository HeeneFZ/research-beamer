import { Deck, DeckItem, Page, Section } from './types';
import type { Computed } from './numbering';

export interface OutlineAnchor { kind: 'slide' | 'section'; id: string; position: 'before' | 'after' | 'inside' }
export interface OutlineSource { kind: 'slide' | 'section'; id: string }
export interface OutlineRow { key: string; section?: Section; page?: Page; path: Section[]; depth: number }
const content = (item: DeckItem) => item.kind === 'slide' && ['content', 'twoCol'].includes(item.slide.layout);
const idOf = (item: DeckItem) => item.kind === 'slide' ? item.slide.id : item.section.id;

export function sectionPathAt(items: DeckItem[], before: number): Section[] {
  const path: Section[] = [];
  for (let i = 0; i < before; i++) {
    const item = items[i];
    if (item.kind !== 'section') continue;
    path[item.section.level - 1] = item.section;
    path.length = item.section.level;
  }
  return path.filter(Boolean);
}

export function sectionEnd(items: DeckItem[], at: number): number {
  const item = items[at];
  if (item?.kind !== 'section') return at + 1;
  for (let i = at + 1; i < items.length; i++) {
    const next = items[i];
    if (next.kind === 'section' && next.section.level <= item.section.level) return i;
  }
  return items.length;
}

export function outlineRows(deck: Deck, computed: Computed): OutlineRow[] {
  const slides = new Map(computed.pages.filter((page) => page.slide).map((page) => [page.slide!.id, page]));
  const dividers = new Map(computed.pages.filter((page) => page.kind === 'divider').map((page) => [page.section!.id, page]));
  const path: Section[] = [];
  return deck.items.map((item) => {
    if (item.kind === 'section') {
      path[item.section.level - 1] = item.section; path.length = item.section.level;
      return { key: item.section.id, section: item.section, page: dividers.get(item.section.id), path: path.filter(Boolean), depth: item.section.level - 1 };
    }
    const context = content(item) ? path.filter(Boolean) : [];
    return { key: item.slide.id, page: slides.get(item.slide.id), path: context, depth: context.length };
  });
}

/** Pure move plan shared by the drop hint and commit; headings use actual item boundaries. */
export function planOutlineMove(items: DeckItem[], source: OutlineSource, anchor: OutlineAnchor | null): { items: DeckItem[]; path: Section[]; candidates: Set<string> } | null {
  const from = items.findIndex((item) => idOf(item) === source.id && item.kind === source.kind);
  if (from < 0 || (source.kind === 'slide' && !content(items[from]))) return null;
  const end = source.kind === 'section' ? sectionEnd(items, from) : from + 1;
  const moved = items.slice(from, end).filter((item) => source.kind === 'slide' || item.kind === 'section' || content(item));
  const movedIds = new Set(moved.map(idOf));
  if (anchor && items.slice(from, end).some((item) => idOf(item) === anchor.id)) return null;
  const remaining = items.filter((item) => !movedIds.has(idOf(item)));
  let at = remaining.length;
  if (anchor) {
    const target = remaining.findIndex((item) => idOf(item) === anchor.id && item.kind === anchor.kind);
    if (target < 0) return null;
    at = target;
    if (anchor.position === 'inside') at++;
    if (anchor.position === 'after') at = source.kind === 'section' && anchor.kind === 'section' ? sectionEnd(remaining, target) : target + 1;
    const targetItem = remaining[target];
    if (targetItem.kind === 'slide' && ['title', 'toc'].includes(targetItem.slide.layout)) return null;
    if (source.kind === 'section' && targetItem.kind === 'section') {
      const section = items[from] as Extract<DeckItem, { kind: 'section' }>;
      if (anchor.position === 'inside' ? section.section.level !== targetItem.section.level + 1 : section.section.level !== targetItem.section.level) return null;
    }
  } else {
    // The report ending remains independent when moving a final chapter.
    while (at > 0 && remaining[at - 1].kind === 'slide' && (remaining[at - 1] as Extract<DeckItem, { kind: 'slide' }>).slide.layout === 'end') at--;
  }
  const reordered = [...remaining.slice(0, at), ...moved, ...remaining.slice(at)];
  const movable = reordered.filter((item) => item.kind === 'section' || content(item));
  let cursor = 0;
  const result = items.map((item) => item.kind === 'section' || content(item) ? movable[cursor++] : item);
  const path = sectionPathAt(result, result.findIndex((item) => idOf(item) === source.id));
  if (result.length === items.length && result.every((item, i) => item === items[i])) return null;
  const sourceLevel = source.kind === 'section' ? (items[from] as Extract<DeckItem, { kind: 'section' }>).section.level : 4;
  return { items: result, path, candidates: new Set(sectionPathAt(items, from).filter((section) => section.level < sourceLevel).map((section) => section.id).filter((id) => !movedIds.has(id))) };
}

/** Linear-time orphan cleanup. Moves only inspect their former ancestor path. */
export function stripOrphanSections(items: DeckItem[], candidates?: ReadonlySet<string>): DeckItem[] {
  let count = 0;
  const boundary = [0, 0, 0, 0];
  const orphan = new Set<string>();
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (content(item)) { count++; continue; }
    if (item.kind !== 'section') continue;
    const { level, id } = item.section;
    if (count === boundary[level] && (!candidates || candidates.has(id))) orphan.add(id);
    for (let depth = level; depth <= 3; depth++) boundary[depth] = count;
  }
  return orphan.size ? items.filter((item) => item.kind !== 'section' || !orphan.has(item.section.id)) : items;
}
