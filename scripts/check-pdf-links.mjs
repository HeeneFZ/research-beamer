// PDF 导出校验：页数 + 内部链接注解（[@..] 引用跳转锚点）。
// 用法：node scripts/check-pdf-links.mjs <pdf 路径> <期望页数>

import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [, , file, expectedPages] = process.argv;
if (!file) {
  console.error('usage: node scripts/check-pdf-links.mjs <pdf> [expectedPages]');
  process.exit(2);
}

const data = new Uint8Array(readFileSync(file));
const pdf = await getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;

console.log('pages =', pdf.numPages);
if (expectedPages && pdf.numPages !== Number(expectedPages)) {
  console.error(`FAIL: 页数 ${pdf.numPages} ≠ 期望 ${expectedPages}`);
  process.exit(1);
}

let links = 0;
const dests = new Set();
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const annots = await page.getAnnotations();
  for (const a of annots) {
    if (a.subtype === 'Link' && (a.dest || a.unsafeUrl)) {
      links++;
      dests.add(JSON.stringify(a.dest ?? a.unsafeUrl));
    }
  }
}
console.log('link annotations =', links, '（去重目标', dests.size, '个）');
if (links === 0) {
  console.error('FAIL: PDF 中无任何链接注解（引用跳转丢失）');
  process.exit(1);
}
console.log('OK');
