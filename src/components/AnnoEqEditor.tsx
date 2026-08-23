// 注释公式编辑弹窗：LaTeX 源 + 交互画布（选中公式文字→标注点；拖拽标签=xshift/yshift）
// + 标注点/标注卡片面板 + 标注样式。移植自 Web 版 annotate-equations 复刻，视觉对齐 Research Beamer 弹窗体系。
// 数据在本地 ref 中编辑（画布即时重绘），「完成」时一次性落库（同 EquationEditor 契约）。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { newId } from '../model/types';
import { AnnoMark, AnnoState, ANNO_PALETTE, defaultAnnoState } from '../model/anno';
import { normLabel } from '../model/markdown';
import { useStore } from '../state/store';
import { Slide, Block } from '../model/types';
import { createAnnoRenderer, AnnoRenderer } from './anno/engine';
import { annoLabelFontCss } from './AnnoEquationView';
import { Modal } from './BlockEditors';
import { LatexEditor, stripMathDelims } from './LatexEditor';

const closeEditing = () => useStore.getState().setEditing(null);
const TYPE_LABELS: Record<AnnoMark['type'], string> = { box: '高亮框', text: '文字着色', plain: '锚点' };
const POS_LABELS: Record<AnnoState['annotations'][number]['pos'], string> = {
  above: '上方', below: '下方', 'above-left': '上方·左', 'below-left': '下方·左',
};

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

interface SelCapture {
  needle: string;
  occ: number;
  vpRect: { left: number; top: number; w: number; h: number };
}

export function AnnoEqEditor({ slide, block }: { slide: Slide; block: Block }) {
  const updateBlock = useStore((s) => s.updateBlock);
  const deleteBlock = useStore((s) => s.deleteBlock);
  const fontEn = useStore((s) => s.deck.config.fontEn);
  const [latex, setLatex] = useState(block.latex || '');
  const [label, setLabel] = useState(block.label || '');
  const [order, setOrder] = useState(block.order != null ? String(block.order) : '');
  const annoRef = useRef<AnnoState>(structuredClone(block.anno ?? defaultAnnoState()));
  const [ver, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const [sel, setSel] = useState<{ markId: string | null; annId: string | null }>({ markId: null, annId: null });
  const selRef = useRef(sel);
  selRef.current = sel;
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [lostIds, setLostIds] = useState<Set<string>>(new Set());
  const [pendingSel, setPendingSel] = useState<SelCapture | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const toast = (m: string) => {
    setToastMsg(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600);
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const eqnRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const annRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<AnnoRenderer | null>(null);
  const anno = annoRef.current;

  const commit = (patch: Partial<Block>) => updateBlock(slide.id, block.id, patch);

  /* ---------------- 画布引擎 ---------------- */
  useLayoutEffect(() => {
    const r = createAnnoRenderer(
      {
        eqn: eqnRef.current!, holder: holderRef.current!, wrap: wrapRef.current!,
        marksLayer: marksRef.current!, annLayer: annRef.current!, svg: svgRef.current!,
      },
      {
        getLatex: () => latex,
        getAnno: () => annoRef.current,
        interactive: true,
        padMin: { v: 88, h: 56, m: 22 },
        labelFontCss: annoLabelFontCss(annoRef.current.labelFont, fontEn, false),
        onMarkSelect: (id) => setSel({ markId: id, annId: null }),
        onMarkDoubleClick: (id) => addAnnotation([id]),
        onAnnDrag: (id, x, y) => setDrag({ id, x, y }),
        onAnnDragEnd: () => { setDrag(null); bump(); },
        getSelected: () => selRef.current,
      },
    );
    rendererRef.current = r;
    const lost = r.renderAll();
    setLostIds(new Set(lost.map((m) => m.id)));
    if (lost.length) toast(`标注点 ${lost.map((m) => m.name).join('、')} 未能重新定位（公式中已找不到对应文字）`);
    let alive = true;
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => { if (alive) r.renderAll(); });
    }
    return () => { alive = false; rendererRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latex, ver, fontEn]);

  /** 选中态变化只重绘画布（不重建引擎） */
  useEffect(() => {
    rendererRef.current?.refreshCanvas();
  }, [sel]);

  /* ---------------- 选区 → 标注点 ---------------- */
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.ae-selbar')) return;
      const selObj = window.getSelection();
      const cap = selObj ? rendererRef.current?.captureSelection(selObj) : null;
      setPendingSel(cap ?? null);
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  /** Esc：先收选区工具栏/取消选中，不冒泡关弹窗 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pendingSel || sel.markId || sel.annId) {
        e.stopPropagation();
        setPendingSel(null);
        setSel({ markId: null, annId: null });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pendingSel, sel]);

  /** 画布滚轮 = 预览字号（仅编辑视口舒适度；原生非被动监听以 preventDefault 防画布滚动） */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const a = annoRef.current;
      a.fontSize = Math.min(48, Math.max(16, a.fontSize - Math.sign(e.deltaY)));
      bump();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** 键盘快捷（输入控件聚焦时跳过）：Del/Backspace 删选中；方向键微调选中标注
   *  （←→ xshift、↑↓ yshift，步长 0.25ex/em，Shift ×4） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = selRef.current;
      const a = annoRef.current;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.markId) {
          a.marks = a.marks.filter((m) => m.id !== s.markId);
          for (const an of a.annotations) an.markIds = an.markIds.filter((x) => x !== s.markId);
          setSel({ markId: null, annId: null });
          e.preventDefault();
          bump();
        } else if (s.annId) {
          a.annotations = a.annotations.filter((x) => x.id !== s.annId);
          setSel({ markId: null, annId: null });
          e.preventDefault();
          bump();
        }
        return;
      }
      if (s.annId && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const an = a.annotations.find((x) => x.id === s.annId);
        if (!an) return;
        const step = (e.shiftKey ? 4 : 1) * 0.25;
        if (e.key === 'ArrowLeft') an.xshift = +(an.xshift - step).toFixed(2);
        else if (e.key === 'ArrowRight') an.xshift = +(an.xshift + step).toFixed(2);
        else if (e.key === 'ArrowUp') an.yshift = +(an.yshift + step).toFixed(2);
        else an.yshift = +(an.yshift - step).toFixed(2);
        e.preventDefault();
        bump();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nextName = (): string => {
    let i = anno.marks.length + 1;
    const names = new Set(anno.marks.map((m) => m.name));
    while (names.has('m' + i)) i++;
    return 'm' + i;
  };

  const createMark = (type: AnnoMark['type']) => {
    if (!pendingSel) return;
    const m: AnnoMark = {
      id: newId(), name: nextName(), type,
      color: type === 'plain' ? null : ANNO_PALETTE[anno.paletteIdx % ANNO_PALETTE.length],
      needle: pendingSel.needle, occ: pendingSel.occ,
    };
    anno.marks.push(m);
    anno.paletteIdx++;
    bump();
    setSel({ markId: m.id, annId: null });
    setPendingSel(null);
    window.getSelection()?.removeAllRanges();
    toast(`已创建标注点 ${m.name}（${TYPE_LABELS[type]}）`);
  };

  const addAnnotation = (markIds: string[] = []) => {
    if (!anno.marks.length) { toast('请先在公式中选中文字创建标注点'); return; }
    anno.annotations.push({
      id: newId(), type: 'one', text: '新标注', pos: 'above', labelBelow: false,
      colorAuto: true, color: '#000000', xshift: 0, yshift: 1, markIds: [...markIds],
    });
    bump();
    setSel({ markId: null, annId: anno.annotations[anno.annotations.length - 1].id });
  };

  const deleteMark = (id: string) => {
    anno.marks = anno.marks.filter((m) => m.id !== id);
    for (const a of anno.annotations) a.markIds = a.markIds.filter((x) => x !== id);
    if (sel.markId === id) setSel({ markId: null, annId: null });
    bump();
  };

  const annColorOf = (a: AnnoState['annotations'][number]): string => {
    const m0 = a.markIds.map((id) => anno.marks.find((m) => m.id === id)).filter(Boolean)[0] as AnnoMark | undefined;
    return a.colorAuto ? m0?.color || '#000000' : a.color;
  };

  const done = () => {
    commit({ latex, label: label ? normLabel('eq', label) : undefined, anno: annoRef.current });
    closeEditing();
  };

  /* ---------------- 选区浮动工具栏（portal 内 fixed 定位） ---------------- */
  const selbar = pendingSel && (
    <div className="ae-selbar"
      style={{
        left: Math.max(170, Math.min(window.innerWidth - 170, pendingSel.vpRect.left + pendingSel.vpRect.w / 2)) + 'px',
        top: Math.min(window.innerHeight - 60, pendingSel.vpRect.top + pendingSel.vpRect.h + 10) + 'px',
      }}>
      <span className="ae-selbar-txt">“{trunc(pendingSel.needle, 18)}”</span>
      <button className="ae-swatch" title="点击切换自动分配的颜色"
        style={{ background: ANNO_PALETTE[anno.paletteIdx % ANNO_PALETTE.length] }}
        onClick={() => { anno.paletteIdx++; bump(); }} />
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => createMark('box')}
        title="\eqnmarkbox — 底色高亮框">高亮框</button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => createMark('text')}
        title="\eqnmark — 文字着色">文字着色</button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => createMark('plain')}
        title="\tikzmarknode — 无视觉标记的锚点">隐形锚点</button>
    </div>
  );

  /* ---------------- 卡片面板 ---------------- */
  const marksList = anno.marks.map((m) => {
    const selected = sel.markId === m.id;
    return (
      <div key={m.id} className={'ae-card' + (selected ? ' selected' : '') + (lostIds.has(m.id) ? ' invalid' : '')}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, select, label')) setSel(selected ? { markId: null, annId: null } : { markId: m.id, annId: null }); }}
        onMouseEnter={() => rendererRef.current?.previewMark(m)}
        onMouseLeave={() => rendererRef.current?.previewMark(null)}>
        <div className="ae-card-row1">
          <span className="ae-dot" style={{ background: m.color || '#9aa3b5' }} />
          <span className="ae-mono">{m.name}</span>
          <span className="ae-badge">{TYPE_LABELS[m.type]}</span>
          <span className="ae-needle" title={m.needle}>{lostIds.has(m.id) ? '⚠ 未定位' : `“${trunc(m.needle, 8)}”`}</span>
          <button className="ae-mini" title="为此标注点新建标注" onClick={() => addAnnotation([m.id])}>标注</button>
          <button className="ae-mini danger" title="删除" onClick={() => deleteMark(m.id)}>✕</button>
        </div>
        {selected && (
          <div className="ae-card-detail">
            <label>颜色 <input type="color" value={m.color || '#000000'} disabled={m.type === 'plain'}
              onChange={(e) => { m.color = e.target.value; bump(); }} /></label>
            <label>名称 <input type="text" defaultValue={m.name} spellCheck={false} title="节点名"
              onChange={(e) => { m.name = e.target.value; }} /></label>
            <label>类型 <select value={m.type}
              onChange={(e) => {
                m.type = e.target.value as AnnoMark['type'];
                if (m.type === 'plain') m.color = null;
                else if (!m.color) m.color = ANNO_PALETTE[anno.paletteIdx++ % ANNO_PALETTE.length];
                bump();
              }}>
              <option value="box">高亮框</option>
              <option value="text">文字着色</option>
              <option value="plain">隐形锚点</option>
            </select></label>
            {lostIds.has(m.id) && <div className="ae-warn">⚠ 公式中未找到对应文字（公式改动后请删除重建）</div>}
          </div>
        )}
      </div>
    );
  });

  const annsList = anno.annotations.map((a) => {
    const selected = sel.annId === a.id;
    const linked = a.markIds.map((id) => anno.marks.find((m) => m.id === id)).filter(Boolean) as AnnoMark[];
    const reason = !linked.length ? '未关联有效标注点'
      : a.type === 'two' && linked.length < 2 ? '连接式标注需要恰好选择 2 个标注点' : null;
    const posOpts = a.type === 'two' ? ['above', 'below'] : ['above', 'below', 'above-left', 'below-left'];
    const dragging = drag?.id === a.id;
    return (
      <div key={a.id} className={'ae-card' + (selected ? ' selected' : '') + (reason ? ' invalid' : '')}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, select, label, .ae-chip')) setSel(selected ? { markId: null, annId: null } : { markId: null, annId: a.id }); }}>
        <div className="ae-card-row1">
          <span className="ae-dot" style={{ background: annColorOf(a) }} />
          <span className="ae-text-preview" title={a.text}>{reason ? '⚠ ' : ''}{trunc(a.text, 14)}</span>
          <span className="ae-badge" title="位置与类型">{a.pos.startsWith('above') ? '↑' : '↓'}{a.type === 'two' ? '⇄' : '→'}</span>
          <span className="ae-badge" title={linked.map((m) => m.name).join(', ') || '未关联'}>{linked.length ? linked.map((m) => m.name).join(',') : '未关联'}</span>
          <button className="ae-mini danger" title="删除标注"
            onClick={() => { anno.annotations = anno.annotations.filter((x) => x !== a); if (sel.annId === a.id) setSel({ markId: null, annId: null }); bump(); }}>✕</button>
        </div>
        {selected && (
          <div className="ae-card-detail">
            <div className="ae-detail-row">
              <input type="text" className="ae-text-input" defaultValue={a.text} spellCheck={false}
                title="标注文字，$...$ 为数学片段，\\\\ 换行"
                onChange={(e) => { a.text = e.target.value; rendererRef.current?.refreshCanvas(); }} />
              <select value={a.type} title="指向式 \annotate / 连接式 \annotatetwo"
                onChange={(e) => {
                  a.type = e.target.value as 'one' | 'two';
                  if (a.type === 'two') { // left/right 对连接式无效
                    if (a.markIds.length > 2) a.markIds = a.markIds.slice(0, 2);
                    a.pos = a.pos.startsWith('above') ? 'above' : 'below';
                  }
                  bump();
                }}>
                <option value="one">指向式</option>
                <option value="two">连接式</option>
              </select>
            </div>
            <div className="ae-detail-row">
              <label>位置 <select value={a.pos} onChange={(e) => { a.pos = e.target.value as typeof a.pos; bump(); }}>
                {posOpts.map((p) => <option key={p} value={p}>{POS_LABELS[p as keyof typeof POS_LABELS]}</option>)}
              </select></label>
              {a.type === 'two' && (
                <label title="对应 annotate keys 的 label below 选项">
                  <input type="checkbox" checked={a.labelBelow}
                    onChange={(e) => { a.labelBelow = e.target.checked; bump(); }} /> 文字置于线下</label>
              )}
              <label>yshift <input type="number" step={0.5}
                value={dragging ? drag!.y : a.yshift}
                onChange={(e) => { a.yshift = parseFloat(e.target.value) || 0; bump(); }} /> em</label>
              <label>xshift <input type="number" step={0.5}
                value={dragging ? drag!.x : a.xshift}
                onChange={(e) => { a.xshift = parseFloat(e.target.value) || 0; bump(); }} /> ex</label>
            </div>
            <div className="ae-detail-row">
              <label><input type="checkbox" checked={a.colorAuto}
                onChange={(e) => { a.colorAuto = e.target.checked; bump(); }} /> 颜色随标记</label>
              <input type="color" value={a.color} disabled={a.colorAuto}
                onChange={(e) => { a.color = e.target.value; bump(); }} />
            </div>
            <div className="ae-chips">
              {anno.marks.length ? anno.marks.map((m) => (
                <span key={m.id} className={'ae-chip' + (a.markIds.includes(m.id) ? ' on' : '')}
                  onClick={() => {
                    if (a.type === 'two') a.markIds = a.markIds.includes(m.id) ? a.markIds.filter((x) => x !== m.id) : [...a.markIds, m.id].slice(-2);
                    else a.markIds = a.markIds.includes(m.id) ? a.markIds.filter((x) => x !== m.id) : [...a.markIds, m.id];
                    bump();
                  }}>
                  <span className="ae-dot sm" style={{ background: m.color || '#999' }} />{m.name}
                </span>
              )) : <span className="ae-hint">先创建标注点</span>}
            </div>
            {reason && <div className="ae-warn">⚠ {reason}</div>}
          </div>
        )}
      </div>
    );
  });

  return (
    <Modal title="注释公式编辑" onClose={done} extra="modal-anno">
      <label className="fld">{'LaTeX 公式（选中画布中的公式文字可创建标注点：高亮框 / 文字着色 / 隐形锚点）'}</label>
      <LatexEditor value={latex} onChange={(v) => setLatex(stripMathDelims(v))} rows={3} autoFocus />
      <div className="ae-meta-row">
        <label className="fld">Label（用于 @eq:label 交叉引用）</label>
        <input className="txt" value={label} placeholder="eq:x"
          onChange={(e) => setLabel(e.target.value)} />
        <label className="fld">出现顺序</label>
        <input className="txt w-num" value={order} placeholder="无"
          onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))}
          onBlur={() => {
            const n = parseInt(order, 10);
            commit({ order: Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined });
          }} />
      </div>

      <div className="ae-editor-main">
        <div className="ae-canvas" ref={canvasRef}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('.ae-mark-box, .ae-ann-label')) return;
            setPendingSel(null);
            if (sel.markId || sel.annId) setSel({ markId: null, annId: null });
          }}>
          {toastMsg && <div className="ae-toast">{toastMsg}</div>}
          {!latex.trim() && <div className="ae-canvas-hint"><span className="big">∑</span>输入公式后在此创建标注</div>}
          <div className="ae-wrap" ref={wrapRef}>
            <div className="ae-holder" ref={holderRef}>
              <div className="eq-disp ae-eqn" ref={eqnRef} style={{ fontSize: anno.fontSize + 'px' }} />
              <div className="ae-marks" ref={marksRef} />
              <svg className="ae-svg" ref={svgRef} />
              <div className="ae-anns" ref={annRef} />
            </div>
          </div>
        </div>

        <div className="ae-panel">
          <div className="ae-pane">
            <div className="ae-pane-title">标注样式</div>
            <div className="ae-opt-grid">
              <label title="编辑预览字号（仅编辑视口舒适度，不影响幻灯片渲染；画布上滚轮可调）">预览字号 <input type="range" min={16} max={48} value={anno.fontSize}
                onChange={(e) => { anno.fontSize = +e.target.value; bump(); }} /> <span className="ae-mono">{anno.fontSize}px</span></label>
              <label title="幻灯片上的公式放大（相对正文字号；标注文字随之可读）">展示放大 <input type="range" min={50} max={200} step={5} value={Math.round(anno.scale * 100)}
                onChange={(e) => { anno.scale = +e.target.value / 100; bump(); }} /> <span className="ae-mono">{Math.round(anno.scale * 100)}%</span></label>
              <label title="标注文字相对公式的字号比例">标注字号 <select value={anno.annFontScale}
                onChange={(e) => { anno.annFontScale = +e.target.value; bump(); }}>
                <option value={0.4}>40%</option><option value={0.5}>50%</option>
                <option value={0.6}>60%</option><option value={0.75}>75%</option><option value={1}>100%</option>
              </select></label>
              <label title="标注文字字体">字体 <select value={anno.labelFont}
                onChange={(e) => { anno.labelFont = e.target.value as AnnoState['labelFont']; bump(); }}>
                <option value="auto">随主题</option><option value="serif">衬线</option><option value="sans">无衬线</option>
              </select></label>
              <label title="高亮框底色浓度">底色 <input type="range" min={5} max={40} value={anno.shade}
                onChange={(e) => { anno.shade = +e.target.value; bump(); }} /> <span className="ae-mono">{anno.shade}%</span></label>
              <label title="高亮框内边距（fboxsep）比例">内距 <input type="range" min={0} max={100} value={Math.round(anno.fboxScale * 100)}
                onChange={(e) => { anno.fboxScale = +e.target.value / 100; bump(); }} /> <span className="ae-mono">{Math.round(anno.fboxScale * 100)}%</span></label>
              <label title="高亮框统一 mathstrut 高度（宏包默认开）"><input type="checkbox" checked={anno.equalHeight}
                onChange={(e) => { anno.equalHeight = e.target.checked; bump(); }} /> 等高框</label>
            </div>
          </div>
          <div className="ae-pane">
            <div className="ae-pane-title">
              标注点{anno.marks.length ? ` · ${anno.marks.length}` : ''}
              <span className="ae-hint">公式中选中文字 → 浮动条</span>
            </div>
            <div className="ae-cards">{marksList.length ? marksList : <div className="ae-empty">尚无标注点</div>}</div>
          </div>
          <div className="ae-pane">
            <div className="ae-pane-title">
              标注{anno.annotations.length ? ` · ${anno.annotations.length}` : ''}
              <button className="ae-mini" disabled={!anno.marks.length}
                title={anno.marks.length ? '新建标注' : '请先创建标注点（在公式中选中文字）'}
                onClick={() => addAnnotation()}>＋ 新建</button>
            </div>
            <div className="ae-cards">{annsList.length ? annsList : <div className="ae-empty">尚无标注</div>}</div>
          </div>
        </div>
      </div>

      <div className="modal-actions">
        <button className="danger" onClick={() => {
          if (!anno.marks.length && !anno.annotations.length) return;
          if (!window.confirm('确定删除全部标注点与标注？（公式保留）')) return;
          anno.marks = []; anno.annotations = []; anno.paletteIdx = 0;
          setSel({ markId: null, annId: null });
          bump();
        }}>清空标注</button>
        <button className="danger" onClick={() => { deleteBlock(slide.id, block.id); closeEditing(); }}>删除块</button>
        <span className="spacer" />
        <button className="primary" onClick={done}>完成</button>
      </div>

      {selbar}
    </Modal>
  );
}
