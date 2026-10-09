// Background progress must not rerender the math/text of every retained page.
import type { Page } from '../../model/types';
import type { PageLayout } from '../../model/layoutSpec';
import type { MediaPreparation, RasterResource } from '../../model/mediaResources';
import { epsTarget } from '../../model/mediaGeometry';
import { absMediaPath } from '../paths';

const media = new WeakMap<Page, { folder: string; value: MediaPreparation }>();
const layouts = new WeakMap<Page, { key: string; state?: PageLayout; value: Record<string, PageLayout> }>();
export function pageMediaSnapshot(page: Page, folder: string, preparation: MediaPreparation): MediaPreparation {
  const resources: Record<string, RasterResource> = {}, errors: Record<string, string> = {}, epsTargets: Record<string, string | null> = {};
  if (preparation.errors.__prepare__) errors.__prepare__ = preparation.errors.__prepare__;
  for (const block of page.slide?.blocks ?? []) {
    if (!block.src) continue;
    const abs = absMediaPath(folder, block.src);
    const converted = preparation.epsTargets?.[abs] !== undefined ? preparation.epsTargets[abs] : epsTarget(abs);
    const target = /\.eps$/i.test(abs) ? converted : abs;
    if (/\.eps$/i.test(abs) && converted !== undefined) epsTargets[abs] = converted;
    if (target && preparation.resources[target]) resources[target] = preparation.resources[target];
    if (preparation.errors[abs]) errors[abs] = preparation.errors[abs];
    if (target && preparation.errors[target]) errors[target] = preparation.errors[target];
  }
  const old = media.get(page);
  if (old?.folder === folder && old.value.session === preparation.session && old.value.phase === preparation.phase
    && Object.keys(old.value.resources).length === Object.keys(resources).length && Object.entries(resources).every(([key, value]) => old.value.resources[key] === value)
    && Object.keys(old.value.errors).length === Object.keys(errors).length && Object.entries(errors).every(([key, value]) => old.value.errors[key] === value)
    && Object.keys(old.value.epsTargets ?? {}).length === Object.keys(epsTargets).length && Object.entries(epsTargets).every(([key, value]) => old.value.epsTargets?.[key] === value)) return old.value;
  const value: MediaPreparation = { session: preparation.session, phase: preparation.phase, completed: 0, total: 0, resources, errors, epsTargets };
  media.set(page, { folder, value }); return value;
}
export function pageLayoutSnapshot(page: Page, aspect: string, source: Record<string, PageLayout>): Record<string, PageLayout> {
  const key = page.slide ? `${page.slide.id}|${aspect}` : '', state = source[key], old = layouts.get(page);
  if (old?.key === key && old.state === state) return old.value;
  const value = state ? { [key]: state } : {};
  layouts.set(page, { key, state, value }); return value;
}
