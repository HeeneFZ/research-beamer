// Shared by deck actions and rendering; preserve absolute Windows/Unix/UNC sources.
export function absMediaPath(folder: string, rel: string): string {
  const source = rel.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(source) || source.startsWith('/')) return source;
  return folder.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + source;
}
