// 路径工具：工程文件夹 + 相对路径 → 绝对路径（全工程唯一实现，避免多处各自拼接漂移）

export function absMediaPath(folder: string, rel: string): string {
  const source = rel.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(source) || /^\/(?!\/)/.test(source)) return source;
  return folder.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + source.replace(/^\/+/, '');
}
