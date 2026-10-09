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
  /** Source EPS paths to prepared PDF targets; transferred with the resource snapshot. */
  epsTargets?: Record<string, string | null>;
  errors: Record<string, string>;
  assetSignature?: string;
  /** Finalized figure widths in the deck's logical CSS coordinates. */
  gifWidths?: Record<string, number>;
}
export interface ViewPreparation {
  scope: string; targetKey: string; ready: boolean; currentReady: boolean; completed: number; total: number;
}
export const emptyViewPreparation = (): ViewPreparation => ({ scope: '', targetKey: '', ready: false, currentReady: false, completed: 0, total: 0 });
export const presentationPreparationKey = (revision: number, deckVersion: string | undefined, layoutVersion: string | undefined, resourceVersion: string | undefined, current: number): string => [revision, deckVersion, layoutVersion, resourceVersion, current].join('|');
export const emptyMediaPreparation = (): MediaPreparation => ({ session: '', phase: 'waiting', completed: 0, total: 0, resources: {}, errors: {} });
export function mediaAssetSignature(deck: Deck): string {
  const assets = new Set(deck.items.flatMap((item) => item.kind === 'slide'
    ? item.slide.blocks.filter((block) => block.src).map((block) => `${block.type}\0${block.src}`) : []));
  return JSON.stringify([deck.config.logo, [...assets].sort()]);
}
