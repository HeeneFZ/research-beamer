import type { Deck } from './types';

export interface ProjectWatchRequest { id: string; folder: string; md: string | null; assets: string[] }
export interface ProjectFileChange { id: string; folder: string; md?: string | null; media?: boolean; error?: string }
export function projectAssets(deck: Deck): string[] {
  const paths = new Set<string>();
  for (const source of [deck.config.logo, deck.config.endLogo, deck.config.titleBackground?.src, deck.config.endBackground?.src]) if (source) paths.add(source);
  for (const item of deck.items) if (item.kind === 'slide') for (const block of item.slide.blocks) if (block.src) paths.add(block.src);
  return [...paths].sort();
}
