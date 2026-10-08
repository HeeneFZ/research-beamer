// PDF 导出：隐藏打印容器渲染全部页 → printToPDF（@page 随比例；引用内链保留）

import { createRoot } from 'react-dom/client';
import { useStore } from './state/store';
import { SlideView } from './components/SlideView';
import { restyleRulesForPrint, VINCULUM_RE } from './components/katexRuleSnap';
import { PAGE_SIZE } from './model/types';

/** PDF 建议文件名：标题可含 $..$ 行内公式（含 \ 等源码字符，Windows 文件名非法）——
 *  剥定界符取 LaTeX 源文本，再剔除文件系统非法字符 */
function pdfName(title: string): string {
  const t = (title || 'deck').replace(/\$([^$]+)\$/g, '$1');
  return t.replace(/[\\/:*?"<>|]/g, '').trim() || 'deck';
}

function checkPrintProject(mediaRevision: number): void {
  if (useStore.getState().mediaRevision !== mediaRevision) throw new Error('工程已切换，本次 PDF 导出已取消');
}

async function waitForPrintContent(host: HTMLElement, pageCount: number, mediaRevision: number): Promise<void> {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    checkPrintProject(mediaRevision);
    const failed = host.querySelector<HTMLElement>('[data-media-error]');
    if (failed) throw new Error(failed.dataset.mediaError || '媒体加载失败');
    const images = [...host.querySelectorAll('img')];
    if (images.some((image) => image.complete && image.naturalWidth === 0)) throw new Error('图片加载失败');
    const canvases = [...host.querySelectorAll('canvas')];
    const ready = host.querySelectorAll('.print-page').length === pageCount
      && images.every((image) => image.complete && image.naturalWidth > 0)
      && canvases.every((canvas) => canvas.width > 0 && canvas.height > 0 && !canvas.dataset.mediaPending)
      && !host.querySelector('[data-eps-pending]')
      && !host.querySelector('[data-layout-ready="false"]')
      && (!document.fonts || document.fonts.status === 'loaded');
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('媒体或字体加载超时，请检查素材后重试');
}

let exporting = false;
async function capturePrintSnapshot(): Promise<ReturnType<typeof useStore.getState>> {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    // Let the current static filmstrip commit its content and geometry before freezing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = useStore.getState();
    const pages = document.querySelectorAll('.filmstrip .sv');
    if (pages.length === state.computed.pages.length
      && [...pages].every((page) => page.getAttribute('data-layout-ready') === 'true')) return state;
  }
  throw new Error('页面排版尚未就绪，请检查素材后重试');
}

export async function exportPDF(): Promise<void> {
  if (exporting) return;
  exporting = true;
  const host = document.createElement('div');
  host.id = 'print-root';
  let root: ReturnType<typeof createRoot> | null = null;
  const style = document.createElement('style');
  try {
    const r = await window.api.exportPDF({ suggestedName: pdfName(useStore.getState().deck.config.title) + '.pdf' });
    if (!r?.path) return;
    const s = await capturePrintSnapshot();
    document.body.appendChild(host);
    root = createRoot(host);
    const c = s.computed;
    root.render(
      c.pages.map((p) => (
        <div className="print-page" key={p.index}>
          <SlideView page={p} deck={s.deck} computed={c} folder={s.folder ?? ''} mode="print" layoutSnapshot={s.pageLayout} mediaSnapshot={s.mediaRevision} />
        </div>
      )),
    );

    await waitForPrintContent(host, c.pages.length, s.mediaRevision);
    await new Promise((r2) => setTimeout(r2, 300)); // 字体/布局稳定
    checkPrintProject(s.mediaRevision);
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
    useStore.getState().setFlashMsg('PDF 导出失败：' + String(e));
  } finally {
    style.remove();
    root?.unmount();
    host.remove();
    exporting = false;
  }
}
