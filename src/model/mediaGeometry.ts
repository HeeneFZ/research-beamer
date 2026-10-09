// View remounts share geometry; reloads invalidate it because the same file may have changed.
let revision = 0;
const aspects = new Map<string, number>();
const failures = new Map<string, string>();
const epsTargets = new Map<string, string | null>();
export const mediaRevision = () => revision;
export const mediaAspect = (abs: string) => aspects.get(abs);
export const mediaFailure = (abs: string) => failures.get(abs);
export const epsTarget = (abs: string) => epsTargets.get(abs);

export function setMediaRevision(next: number, force = false): void {
  if (revision === next && !force) return;
  revision = next;
  aspects.clear();
  failures.clear();
  epsTargets.clear();
}

export function rememberMediaFailure(abs: string, message: string, version = revision): void {
  if (version !== revision) return;
  failures.set(abs, message);
  if (!aspects.has(abs)) aspects.set(abs, 16 / 9);
}

export function rememberEpsTarget(abs: string, pdf: string | null, version = revision): void {
  if (version === revision) epsTargets.set(abs, pdf);
}

export function rememberMediaAspect(abs: string, aspect: number, version = revision): void {
  if (version !== revision) return;
  aspects.delete(abs);
  aspects.set(abs, aspect);
}
