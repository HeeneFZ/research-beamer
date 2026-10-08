// 注释公式块（annoeq）展示渲染 —— 编辑画布/胶片/放映/PDF 四模式共用。
// 公式字号随页面排版（.eq-disp .katex 1em 合约：与正文等大、fit 压缩跟随）；
// 标注几何由引擎按实际 px 测量，ResizeObserver 跟随字号变化重测（锚定与字号解耦）。

import { useLayoutEffect, useRef, useState } from 'react';
import { Block } from '../model/types';
import { Computed } from '../model/numbering';
import { AnnoState, defaultAnnoState } from '../model/anno';
import { createAnnoRenderer } from './anno/engine';
import { slideFontStack } from '../model/fonts';
import { ScaleHandles } from './ScaleHandles';

/** 与 styles.css .sv[data-fen] 字体栈一致（弹窗在 .sv 外时手动指定） */
export const ANNO_FONT_STACKS: Record<'serif' | 'sans', string> = {
  serif: slideFontStack('serif', 'serif'),
  sans: slideFontStack('sans', 'sans'),
};

/** 标注文字 font-family：auto = 继承（幻灯片内 .sv 已带主题栈）；弹窗内需显式解析 */
export function annoLabelFontCss(labelFont: AnnoState['labelFont'], fontEn: 'serif' | 'sans', inheritAuto: boolean, fontZh = fontEn): string {
  if (labelFont !== 'auto') return ANNO_FONT_STACKS[labelFont];
  return inheritAuto ? '' : slideFontStack(fontEn, fontZh);
}

export function AnnoEquationView({
  block, computed, highlight, onScaleChange,
}: {
  block: Block; computed: Computed; highlight?: boolean; onScaleChange?: (scale: number) => void;
}) {
  const num = computed.equationNum.get(block.id);
  const anno = block.anno ?? defaultAnnoState();
  const latex = block.latex || '';
  const annoKey = JSON.stringify(anno);
  const [previewScale, setPreviewScale] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const eqnRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const annRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const r = createAnnoRenderer(
      {
        eqn: eqnRef.current!, holder: holderRef.current!, wrap: wrapRef.current!,
        marksLayer: marksRef.current!, annLayer: annRef.current!, svg: svgRef.current!,
      },
      {
        getLatex: () => latex,
        getAnno: () => anno,
        interactive: false,
        padMin: { v: 2, h: 6, m: 3 },
        labelFontCss: annoLabelFontCss(anno.labelFont, 'serif', true),
      },
    );
    r.renderAll();
    const wrap = wrapRef.current!;
    const refresh = () => r.refreshCanvas();
    wrap.addEventListener('layoutprobe', refresh);
    // KaTeX 字体晚到会使墨迹度量用到回退字体（高亮框偏大）——就绪后重测一次
    let alive = true;
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => { if (alive) r.renderAll(); });
    }
    // 字号变化（fit 压缩/fontScale/比例切换）→ 公式元素宽度变 → 全量重测
    let lastW = -1;
    const ro = new ResizeObserver(() => {
      const w = eqnRef.current?.offsetWidth ?? 0;
      if (Math.abs(w - lastW) > 0.5) { lastW = w; r.refreshCanvas(); }
    });
    ro.observe(eqnRef.current!);
    return () => { alive = false; ro.disconnect(); wrap.removeEventListener('layoutprobe', refresh); };
    // annoKey：对象每次解析都是新引用，用序列化串做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latex, annoKey]);

  return (
    <div className={'eq-outer ae-outer' + (highlight ? ' flash-hl' : '')}>
      <div className="eq-row ae-row">
        <div className="eq-body">
          <div className={'ae-wrap' + (onScaleChange ? ' scalable-equation' : '')} ref={wrapRef}>
            <div className="ae-holder" ref={holderRef}>
              <div className="eq-disp ae-eqn" ref={eqnRef} style={{ fontSize: `calc(1em * ${previewScale ?? anno.scale})` }} />
              <div className="ae-marks" ref={marksRef} />
              <svg className="ae-svg" ref={svgRef} />
              <div className="ae-anns" ref={annRef} />
            </div>
            {onScaleChange && <ScaleHandles hostRef={wrapRef} scale={anno.scale} onPreview={setPreviewScale} onCommit={onScaleChange} />}
          </div>
        </div>
        {num != null && <div className="eq-num">({num})</div>}
      </div>
    </div>
  );
}
