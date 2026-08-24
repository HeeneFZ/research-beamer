// 行内语法解析：$..$ 公式、[@eq:x] 引用、[文字]{color=角色} 文字色、[文字]{bg=角色} 底色、**粗体**、*斜体*

export type InlineToken =
  | { t: 'text'; v: string }
  | { t: 'math'; v: string }
  | { t: 'ref'; label: string }
  | { t: 'color'; role: string; children: InlineToken[] }
  | { t: 'bg'; role: string; children: InlineToken[] }
  | { t: 'bold'; children: InlineToken[] }
  | { t: 'italic'; children: InlineToken[] };

/** 从 pos 起找未转义的 ch，返回索引；找不到 -1 */
function findUnescaped(s: string, ch: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === ch) return i;
  }
  return -1;
}

export function tokenizeInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  let buf = '';
  const flushText = () => {
    if (buf) {
      out.push({ t: 'text', v: buf });
      buf = '';
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // 行内公式 $...$
    if (c === '$' && src[i + 1] !== '$' && src[i + 1] !== ' ') {
      const end = findUnescaped(src, '$', i + 1);
      if (end > i + 1 && src[end + 1] !== '$') {
        flushText();
        out.push({ t: 'math', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // 引用 [@eq:x]；双重前缀（[@eq:eq:x]，picker 旧 bug 的历史脏数据）自愈剥除
    if (c === '[' && src[i + 1] === '@') {
      const end = src.indexOf(']', i + 2);
      if (end > 0) {
        const label = src.slice(i + 2, end).replace(/^(\w+):\1:/, '$1:');
        if (/^\w+:[\w-]+$/.test(label)) {
          flushText();
          out.push({ t: 'ref', label });
          i = end + 1;
          continue;
        }
      }
    }
    // 文字色/底色 [文字]{color=角色} / [文字]{bg=角色} / 组合 [文字]{color=x,bg=y}
    if (c === '[') {
      const close = findUnescaped(src, ']', i + 1);
      if (close > 0 && src[close + 1] === '{') {
        const m = src.slice(close + 1).match(/^\{((?:color|bg)=[\w-]+(?:,(?:color|bg)=[\w-]+)?)\}/);
        if (m && m.index === 0) {
          flushText();
          const spec = m[1].split(',');
          const colorRole = spec.find((p) => p.startsWith('color='))?.slice(6);
          const bgRole = spec.find((p) => p.startsWith('bg='))?.slice(3);
          // 规范嵌套：bg 在内、color 在外（与序列化器输出一致）
          let children = tokenizeInline(src.slice(i + 1, close));
          if (bgRole) children = [{ t: 'bg', role: bgRole, children }];
          if (colorRole) children = [{ t: 'color', role: colorRole, children }];
          out.push(...children);
          i = close + 1 + m[0].length;
          continue;
        }
      }
    }
    // 粗体 **..**
    if (c === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 1) {
        flushText();
        out.push({ t: 'bold', children: tokenizeInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    // 斜体 *..*
    if (c === '*' && src[i + 1] !== ' ' && src[i + 1] !== '*') {
      const end = src.indexOf('*', i + 1);
      if (end > i + 1) {
        flushText();
        out.push({ t: 'italic', children: tokenizeInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flushText();
  return out;
}
