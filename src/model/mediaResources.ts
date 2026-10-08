import type { Deck } from './types';

export interface RasterResource {
  session: string; id: string; version: number; stamp: string;
  width: number; height: number; aspect: number;
}
export interface MediaPreparation {
  session: string;
  phase: 'waiting' | 'preparing' | 'ready';
  completed: number; total: number;
  resources: Record<string, RasterResource>;
  errors: Record<string, string>;
  assetSignature?: string;
}
export const emptyMediaPreparation = (): MediaPreparation => ({ session: '', phase: 'waiting', completed: 0, total: 0, resources: {}, errors: {} });
export function mediaAssetSignature(deck: Deck): string {
  const assets = new Set(deck.items.flatMap((item) => item.kind === 'slide'
    ? item.slide.blocks.filter((block) => block.src).map((block) => `${block.type}\0${block.src}`) : []));
  return JSON.stringify([deck.config.logo, [...assets].sort()]);
}
