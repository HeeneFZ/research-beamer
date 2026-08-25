// PDF 导出：隐藏打印容器渲染全部页 → printToPDF（@page 随比例；引用内链保留）

import { createRoot } from 'react-dom/client';
import { useStore } from './state/store';
import { SlideView } from './components/SlideView';
import { restyleRulesForPrint } from './components/katexRuleSnap';
import { Deck, PAGE_SIZE } from './model/types';

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
  const r = await window.api.exportPDF({ suggestedName: (s.deck.config.title || 'deck') + '.pdf' });
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
