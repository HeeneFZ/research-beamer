// PDF 导出：隐藏打印容器渲染全部页 → printToPDF（@page 随比例；引用内链保留）

import { createRoot } from 'react-dom/client';
import { useStore } from './state/store';
import { SlideView } from './components/SlideView';
import { restyleRulesForPrint, VINCULUM_RE } from './components/katexRuleSnap';
import { Deck, PAGE_SIZE } from './model/types';

/** PDF 建议文件名：标题可含 $..$ 行内公式（含 \ 等源码字符，Windows 文件名非法）——
 *  剥定界符取 LaTeX 源文本，再剔除文件系统非法字符 */
function pdfName(title: string): string {
  const t = (title || 'deck').replace(/\$([^$]+)\$/g, '$1');
  return t.replace(/[\\/:*?"<>|]/g, '').trim() || 'deck';
}

function countMedia(deck: Deck): number {
  let n = 0;
  for (const it of deck.items) {
    if (it.kind === 'slide') {
      for (const b of it.slide.blocks) {
        if (b.type === 'figure' || b.type === 'video') n++;
      }
    }
  }
  return n;
}

export async function exportPDF(): Promise<void> {
  const s = useStore.getState();
  const r = await window.api.exportPDF({ suggestedName: pdfName(s.deck.config.title) + '.pdf' });
  if (!r?.path) return;

  const host = document.createElement('div');
  host.id = 'print-root';
  document.body.appendChild(host);
  const root = createRoot(host);
  const style = document.createElement('style');
  try {
    const c = s.computed;
    root.render(
      c.pages.map((p) => (
        <div className="print-page" key={p.index}>
          <SlideView page={p} deck={s.deck} computed={c} folder={s.folder ?? ''} mode="print" />
        </div>
      )),
    );

    // 等图片/矢量画布就绪（轮询，最长 15s）
    await new Promise<void>((resolve) => {
      const t0 = Date.now();
      const poll = () => {
        const imgs = [...host.querySelectorAll('img')];
        const canvases = [...host.querySelectorAll('canvas')];
        const imgsOk = imgs.every((i) => i.complete && i.naturalWidth > 0);
        const cvsOk = canvases.every((cv) => cv.width > 0);
        if (imgsOk && cvsOk && imgs.length + canvases.length >= countMedia(s.deck)) resolve();
        else if (Date.now() - t0 > 15000) resolve();
        else setTimeout(poll, 200);
      };
      poll();
    });
    await new Promise((r2) => setTimeout(r2, 300)); // 字体/布局稳定
    // 规则线（分数线等）按打印矢量口径重算：屏幕态的 1 设备行下限在矢量输出中
    // 会让规则线比字形笔画粗 ~2×，PDF 需要纯 0.04em 设计值
    restyleRulesForPrint();
    // E2E 断言快照：print 态在卸载后不可见，导出前把规则线终态挂到 window
    if (window.api.isE2E) {
      const rule = host.querySelector('.katex .frac-line') as HTMLElement | null;
      const path = host.querySelector('.hide-tail path');
      window.__printRuleCheck = {
        bandPx: rule ? parseFloat((getComputedStyle(rule).backgroundSize.split(' ')[1])) : 0,
        fontSizePx: rule ? parseFloat(getComputedStyle(rule).fontSize) : 0,
        sqrtV: (() => { VINCULUM_RE.lastIndex = 0; const m = VINCULUM_RE.exec(path?.getAttribute('d') || ''); return m ? parseFloat(m[2]) : null; })(),
      };
    }

    const size = PAGE_SIZE[s.deck.config.aspect];
    style.textContent = `@page { size: ${size.w}mm ${size.h}mm !important; margin: 0; }`;
    document.head.appendChild(style);

    const out = await window.api.printPDF({ savePath: r.path });
    const bytes = out && 'bytes' in out ? out.bytes : 0;
    s.setFlashMsg(bytes ? `PDF 已导出（${(bytes / 1048576).toFixed(1)} MB）` : 'PDF 导出失败');
  } catch (e) {
    s.setFlashMsg('PDF 导出失败：' + String(e));
  } finally {
    style.remove();
    root.unmount();
    host.remove();
  }
}
