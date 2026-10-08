// 块编辑器集：居中弹窗（图/视频属性、公式、表格）+ 插入媒体
// 段落/列表的行内编辑见 InlineEditor.tsx（TipTap）。
// 弹窗体系对齐 EditorApp ModalShell：modal-mask + modal + fld/txt + modal-actions，
// 全部 px 单位（portal 到 body，cqw 在 .sv 容器外会退化为 vw，故弹窗内禁用 cqw 类）。

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { slideOf, useStore } from '../state/store';
import { Block, Slide } from '../model/types';
import { Computed } from '../model/numbering';
import { normLabel } from '../model/markdown';
import { EquationView } from './SlideViewEquation';
import { absMediaPath } from './paths';
import { fileUrl } from './pdfRaster';
import { PdfCanvas, EpsFigure } from './FigureView';
import { LatexEditor, stripMathDelims } from './LatexEditor';
import { RichFieldEditor } from './RichFieldEditor';
import { Popover, elementAnchor } from './Popover';
import type { AnchorRect } from './OrderPicker';
import { IcoClose } from './icons';
const closeEditing = () => useStore.getState().setEditing(null);

const num = (v: string): number | undefined => {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : undefined;
};

const absMedia = absMediaPath;

export function Modal({ title, children, onClose, wide, extra }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; extra?: string;
}) {
  const bornAt = useRef(Date.now());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (!e.isComposing && e.keyCode !== 229 && e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    // 遮罩 mousedown 关闭：挂载 250ms 内忽略——双击编辑块时第二击会落到遮罩上误关
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget && Date.now() - bornAt.current > 250) onClose(); }}>
      <div className={'modal' + (wide ? ' modal-wide' : '') + (extra ? ' ' + extra : '')}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="modal-close" onMouseDown={(e) => e.preventDefault()} onClick={onClose}><IcoClose /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** 图/视频属性弹窗：预览 + 宽/label/题注/序 + 放大/另存/更换/删除（EditorApp FigureModal 式） */
export function MediaPanel({ slide, block, kind }: { slide: Slide; block: Block; kind: 'figure' | 'video' }) {
  const updateBlock = useStore((s) => s.updateBlock);
  const deleteBlock = useStore((s) => s.deleteBlock);
  const folder = useStore((s) => s.folder);
  const setLightbox = useStore((s) => s.setLightbox);
  const setFlashMsg = useStore((s) => s.setFlashMsg);
  const [width, setWidth] = useState(block.width != null ? String(block.width) : '');
  const [label, setLabel] = useState(block.label || '');
  const [caption, setCaption] = useState(block.caption || '');
  const [order, setOrder] = useState(block.order != null ? String(block.order) : '');
  const prefix = kind === 'figure' ? 'fig' : 'vid';
  const commit = (patch: Partial<Block>) => updateBlock(slide.id, block.id, patch);
  const abs = folder && block.src ? absMedia(folder, block.src) : null;
  const lower = (block.src || '').toLowerCase();
  const done = () => {
    const w = num(width), o = num(order);
    commit({ width: w != null && w > 0 && w <= 1 ? w : undefined,
      label: kind === 'figure' ? (label ? normLabel(prefix, label) : undefined) : block.label,
      caption: caption || undefined, order: o != null && o >= 1 ? Math.floor(o) : undefined });
    closeEditing();
  };

  const saveAs = async () => {
    if (!folder || !block.src) return;
    const r = await window.api.saveMediaAs({ srcPath: absMedia(folder, block.src) });
    if (r && r.error) setFlashMsg('保存失败：' + r.error);
    else if (r) setFlashMsg('已保存图像 → ' + r.path);
  };
  const replaceMedia = async () => {
    if (!folder) return;
    const r = await window.api.pickMedia();
    if (!r) return;
    const imp = await window.api.importMedia({ srcPath: r.path, folder });
    if (imp && imp.fileName) commit({ src: 'media/' + imp.fileName });
  };

  return (
    <Modal title={kind === 'figure' ? '图片属性' : '视频属性'} onClose={done} wide>
      {abs && (
        <div className="media-preview">
          {kind === 'video' ? (
            <video src={fileUrl(abs)} controls muted />
          ) : lower.endsWith('.pdf') ? (
            <div className="media-preview-vec"><PdfCanvas abs={abs} /></div>
          ) : lower.endsWith('.eps') ? (
            <div className="media-preview-vec"><EpsFigure abs={abs} /></div>
          ) : (
            <img src={fileUrl(abs)} alt="" draggable={false} />
          )}
        </div>
      )}
      <label className="fld">显示宽度（页宽比例 0–1；留空 = 按页面密度自动）</label>
      <input className="txt w-num" value={width} placeholder="自动"
        onChange={(e) => setWidth(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={() => { const n = num(width); commit({ width: n != null && n > 0 && n <= 1 ? n : undefined }); }} />
      {kind === 'figure' && (
        <>
          {/* 视频不支持交叉引用（refParts/tokenizer 只认 eq/fig/sec/tab），不展示 Label 字段防误导 */}
          <label className="fld">Label（可选，用于 @{prefix}:x 交叉引用）</label>
          <input className="txt" value={label} placeholder={`${prefix}:x`}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => commit({ label: label ? normLabel(prefix, label) : undefined })} />
        </>
      )}
      <label className="fld">题注</label>
      <input className="txt" value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => commit({ caption: caption || undefined })} />
      <label className="fld">出现顺序（1 起，相同同时出现；留空无动画）</label>
      <input className="txt w-num" value={order} placeholder="无"
        onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))}
        onBlur={() => { const n = num(order); commit({ order: n != null && n >= 1 ? Math.floor(n) : undefined }); }} />
      <div className="modal-actions">
        <button className="danger" onMouseDown={(e) => e.preventDefault()}
          onClick={() => { deleteBlock(slide.id, block.id); closeEditing(); }}>删除</button>
        <span className="spacer" />
        {kind === 'figure' && (
          <button onMouseDown={(e) => e.preventDefault()}
            onClick={() => folder && block.src && setLightbox({ abs: absMedia(folder, block.src), ext: (block.src!.split('.').pop() || '').toLowerCase(), caption: block.caption })}>
            放大查看</button>
        )}
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => { void saveAs(); }}>保存图像副本…</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => { void replaceMedia(); }}>更换媒体…</button>
        <button className="primary" onClick={done}>完成</button>
      </div>
    </Modal>
  );
}

/** 公式弹窗：LaTeX 高亮编辑器 + 实时预览（EditorApp EquationModal 式） */
export function EquationEditor({ slide, block, computed }: {
  slide: Slide; block: Block; computed: Computed;
}) {
  const updateBlock = useStore((s) => s.updateBlock);
  const palette = useStore((s) => s.deck.config.palette);
  const lang = useStore((s) => s.deck.config.language);
  const [latex, setLatex] = useState(block.latex || '');
  const [label, setLabel] = useState(block.label || '');
  const [order, setOrder] = useState(block.order != null ? String(block.order) : '');
  const commit = (patch: Partial<Block>) => updateBlock(slide.id, block.id, patch);
  // latex 在关闭/提交时落盘（编辑中途不落，避免每次击键触发页面重排）
  const commitAll = () => {
    const o = num(order);
    commit({ latex, label: label ? normLabel('eq', label) : undefined, order: o != null && o >= 1 ? Math.floor(o) : undefined });
  };
  const done = () => { commitAll(); closeEditing(); };
  const live = { ...block, latex, label: label ? normLabel('eq', label) : undefined };
  return (
    <Modal title="公式编辑" onClose={done} wide>
      <label className="fld">{'LaTeX 公式（\\ 命令联想，Tab/Enter 补全；注释语法 \\annotate[accent]{\\mu}{说明}，角色可加 ,box）'}</label>
      <LatexEditor value={latex} onChange={(v) => setLatex(stripMathDelims(v))} rows={5} autoFocus onSubmit={done} />
      <label className="fld">Label（可选，用于 @eq:label 交叉引用）</label>
      <input className="txt" value={label} placeholder="eq:x"
        onChange={(e) => setLabel(e.target.value)} />
      <label className="fld">出现顺序（1 起；留空无动画）</label>
      <input className="txt w-num" value={order} placeholder="无"
        onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))}
        onBlur={() => { const n = num(order); commit({ order: n != null && n >= 1 ? Math.floor(n) : undefined }); }} />
      <div className="eq-preview">
        {latex.trim()
          ? <EquationView block={live} computed={computed} palette={palette} lang={lang} />
          : <div className="eq-preview-empty">实时预览</div>}
      </div>
      <div className="modal-actions">
        <button className="primary" onClick={done}>完成</button>
      </div>
    </Modal>
  );
}

/** 三线表弹窗：单元格 + 增删行列 + 属性 */
export function TableEditor({ slide, block }: { slide: Slide; block: Block }) {
  const updateBlock = useStore((s) => s.updateBlock);
  const deleteBlock = useStore((s) => s.deleteBlock);
  const [caption, setCaption] = useState(block.caption || '');
  const [label, setLabel] = useState(block.label || '');
  const [order, setOrder] = useState(block.order != null ? String(block.order) : '');
  const cells = block.cells || [[]];
  const commit = (patch: Partial<Block>) => updateBlock(slide.id, block.id, patch);
  const setCells = (c: string[][]) => commit({ cells: c });
  const done = () => {
    const o = num(order);
    commit({ label: label ? normLabel('tab', label) : undefined, caption: caption || undefined, order: o != null && o >= 1 ? Math.floor(o) : undefined });
    closeEditing();
  };
  return (
    <Modal title="表格编辑" onClose={done} wide>
      <table className="three-line edit">
        <tbody>
          {cells.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j} className={i === 0 ? 'th' : undefined}>
                  <input
                    value={c}
                    onChange={(e) => {
                      const next = cells.map((r) => [...r]);
                      next[i][j] = e.target.value;
                      setCells(next);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal-toolbar">
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => setCells([...cells, new Array(cells[0]?.length || 1).fill('')])}>行＋</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => { if (cells.length > 1) setCells(cells.slice(0, -1)); }}>行−</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => setCells(cells.map((r) => [...r, '']))}>列＋</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => { if ((cells[0]?.length || 0) > 1) setCells(cells.map((r) => r.slice(0, -1))); }}>列−</button>
      </div>
      <label className="fld">Label（可选，用于 @tab:x 交叉引用）</label>
      <input className="txt" value={label} placeholder="tab:x"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => commit({ label: label ? normLabel('tab', label) : undefined })} />
      <label className="fld">题注</label>
      <input className="txt" value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => commit({ caption: caption || undefined })} />
      <label className="fld">出现顺序（1 起；留空无动画）</label>
      <input className="txt w-num" value={order} placeholder="无"
        onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))}
        onBlur={() => { const n = num(order); commit({ order: n != null && n >= 1 ? Math.floor(n) : undefined }); }} />
      <div className="modal-actions">
        <button className="danger" onMouseDown={(e) => e.preventDefault()} onClick={() => { deleteBlock(slide.id, block.id); closeEditing(); }}>删除表格</button>
        <span className="spacer" />
        <button className="primary" onClick={done}>完成</button>
      </div>
    </Modal>
  );
}
/** 页标题编辑（页眉处，支持 $$ 行内公式芯片） */
export function TitleEditor({ slide }: { slide: Slide }) {
  const updateSlide = useStore((s) => s.updateSlide);
  // 结束编辑仅在编辑态仍指向本字段时收起——失焦判定是延迟 150ms 的，
  // 期间用户直接点开另一字段时不得把新编辑态关掉（InlineBlockEditor 同款守卫）
  const done = () => {
    const e = useStore.getState().editing;
    if (e && e.slideId === slide.id && e.field === 'title') closeEditing();
  };
  return (
    <RichFieldEditor
      cls="title-edit"
      live
      value={slide.title || ''}
      placeholder="页面标题"
      onCommit={(v) => updateSlide(slide.id, { title: v || undefined })}
      onDone={done}
      onCancel={done}
    />
  );
}

/** Keep the rendered cover grammar in place; source editing lives in a screen-space popup. */
export function CoverFieldEditor({ slideId, value, rawValue, onCommit, placeholder, math, preview, label }: {
  slideId: string; value: string; rawValue?: string; onCommit: (v: string) => void;
  placeholder?: string; math?: boolean; preview: ReactNode; label?: string;
}) {
  const session = useRef(useStore.getState().editing).current;
  const initial = useRef({ display: value, raw: rawValue ?? value }).current;
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [text, setText] = useState(value);
  const textRef = useRef(text);
  const closed = useRef(false);
  textRef.current = text;
  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`.mode-edit [data-cover-field="${session?.field}"]`);
    if (target) setAnchor(elementAnchor(target));
  }, []);
  const commit = (text: string) => {
    if (!slideOf(useStore.getState().deck, slideId)) return;
    onCommit(text === initial.display ? initial.raw : text);
  };
  const done = () => {
    if (closed.current) return;
    closed.current = true;
    if (!math) commit(textRef.current);
    if (useStore.getState().editing === session) closeEditing();
  };
  const cancel = () => { closed.current = true; commit(initial.raw); if (useStore.getState().editing === session) closeEditing(); };
  useEffect(() => () => { if (!math && !closed.current) commit(textRef.current); }, []);
  return <>{preview}{anchor && <Popover anchor={anchor} className="field-popover" onClose={done}>
    <div className="field-popover-label">{label ?? '编辑字段'}</div>
    {math ? <RichFieldEditor cls="field-input" live multiline={session?.field === 'coverTitle'} value={value}
      onCommit={commit} onDone={done} onCancel={cancel} placeholder={placeholder} /> :
      <input className="field-input" autoFocus value={text} spellCheck={false} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') done();
          if (e.key === 'Escape') cancel();
        }} />}
    <div className="field-popover-hint">{session?.field === 'coverAuthors' ? '多位作者用 ; 分隔，上标写成 姓名^1,2' : session?.field === 'coverAff' ? '多个单位用 ; 分隔，序号对应作者上标' : math ? '$…$ 插入公式；Enter 完成，Esc 取消' : 'Enter 完成，Esc 取消'}</div>
    <button onMouseDown={(e) => e.preventDefault()} onClick={done}>完成</button>
  </Popover>}</>;
}
/** 页脚附加信息编辑（纯页级：写入本页 slide.footNote；空值=本页页脚留空，无全局回退）。
 *  提交三通道：Enter 显式提交 / onBlur 失焦提交 / 卸载兜底提交——画布空白 mousedown
 *  先把 editing 置空，组件卸载时 blur 不派发（DOM 已摘除），onBlur 永远不跑，
 *  点击外部退出会丢全部输入（用户实测报障；Enter 不丢因走 keydown）。 */
export function FooterEditor({ slide }: { slide: Slide }) {
  const updateSlide = useStore((s) => s.updateSlide);
  const [val, setVal] = useState(slide.footNote ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const editingAtMount = useRef(useStore.getState().editing).current;
  // 最新值/已终态标记进 ref：cleanup 闭包拿到的是挂载时的 val（闭包陷阱）
  const valRef = useRef(val);
  valRef.current = val;
  const doneRef = useRef(false);
  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    // 空串=本页页脚留空；非空=写入本页
    updateSlide(slide.id, { footNote: valRef.current === '' ? undefined : valRef.current });
  };
  useEffect(() => {
    ref.current?.focus();
    return () => {
      commit();
      if (useStore.getState().editing === editingAtMount) closeEditing();
    };
  }, []);
  return (
    <input
      ref={ref}
      className="foot-edit"
      spellCheck={false}
      value={val}
      placeholder="本页页脚附加信息"
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          closeEditing();
        } else if (e.key === 'Escape') {
          doneRef.current = true; // Esc = 取消（不提交）
          closeEditing();
        }
        e.stopPropagation();
      }}
    />
  );
}

/** 插入媒体（图/视频） */
export async function insertMediaBlock(slideId: string, afterId: string | null, kind: 'figure' | 'video') {
  const s = useStore.getState();
  if (!s.folder) {
    s.setFlashMsg('请先保存工程（需要 media/ 目录）');
    return;
  }
  const r = await window.api.pickMedia();
  if (!r) return;
  const imp = await window.api.importMedia({ srcPath: r.path, folder: s.folder });
  if (!imp || imp.error || !imp.fileName) {
    s.setFlashMsg('媒体导入失败');
    return;
  }
  // 新插入图/视频不设 width：由排版引擎按页面密度自动给宽（用户可在属性弹窗中显式覆盖）
  const id = s.insertBlock(slideId, afterId, kind, {
    src: 'media/' + imp.fileName,
  });
  useStore.getState().setEditing({ slideId, blockId: id });
}
