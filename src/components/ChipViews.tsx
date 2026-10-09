// React nodeviews for inline atom nodes: math, cross-ref chip.
// 行内公式编辑 = math-float 浮层（portal 到 body，脱离 ProseMirror DOM，
// 按键不被编辑器拦截；复用 LatexEditor 的高亮与 \ 联想）——EditorApp 同款。
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { katexHtml, preprocessMath } from './MathView';
import { LatexEditor, stripMathDelims } from './LatexEditor';
import { refDisplay, refPageIndex, refParts } from '../model/numbering';
import { PROJECT_DRAFT_FLUSH, useStore } from '../state/store';

/** 行内公式浮层编辑器：Enter 提交、Esc 取消、点击浮层外提交关闭 */
function MathFloatEditor({ latex, rect, onCommit, onCancel }: {
  latex: string; rect: { left: number; top: number };
  onCommit: (v: string) => void; onCancel: () => void;
}) {
  const [val, setVal] = useState(latex);
  const boxRef = useRef<HTMLDivElement>(null);
  const valRef = useRef(val);
  valRef.current = val;
  const callbacks = useRef({ onCommit, onCancel });
  callbacks.current = { onCommit, onCancel };
  const closed = useRef(false);
  const alive = useRef(true);
  const state = useStore.getState();
  const owner = useRef({ revision: state.mediaRevision, editing: state.editing, current: state.current }).current;
  const valid = () => {
    const current = useStore.getState();
    return alive.current && !current.projectExiting && current.mediaRevision === owner.revision
      && current.editing === owner.editing && current.current === owner.current;
  };
  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    if (valid()) callbacks.current.onCommit(valRef.current);
  };
  const cancel = () => {
    if (closed.current) return;
    closed.current = true;
    if (valid()) callbacks.current.onCancel();
  };
  // Capture commits the child transaction before App closes the parent editor.
  useEffect(() => {
    alive.current = true;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) finish();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener(PROJECT_DRAFT_FLUSH, finish, true);
    return () => {
      alive.current = false;
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener(PROJECT_DRAFT_FLUSH, finish, true);
    };
  }, []);
  return createPortal(
    <div ref={boxRef} className="math-float" style={{ left: rect.left, top: rect.top }}
      onMouseDown={(e) => e.stopPropagation()}>
      <LatexEditor value={val} onChange={(v) => { const value = stripMathDelims(v); valRef.current = value; setVal(value); }} rows={2} autoFocus
        onSubmit={finish} onCancel={cancel} />
      <div className="math-float-hint">Enter 提交 · Esc 取消 · 点外部关闭 · \ 命令联想</div>
    </div>,
    document.body,
  );
}

export function InlineMathView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);
  const latex: string = node.attrs.latex ?? '';
  const palette = useStore((s) => s.deck.config.palette);
  const tex = useMemo(() => preprocessMath(latex, palette).tex, [latex, palette]);
  const html = useMemo(() => katexHtml(tex, false), [tex]);
  const spanRef = useRef<HTMLSpanElement | null>(null);

  const openAt = (r: { left: number; bottom: number; top: number }) => {
    // 浮层默认放公式下方；贴近视口底部时翻到上方
    const top = r.bottom + 40 + 130 > window.innerHeight ? Math.max(8, r.top - 140) : r.bottom + 4;
    setRect({ left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), top });
    setEditing(true);
  };

  const openEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    openAt(((spanRef.current ?? e.currentTarget) as HTMLElement).getBoundingClientRect());
  };

  // 键入 $…$ 新插入的空公式：挂载即开浮层（EditorApp 同流程）
  useEffect(() => {
    if (!latex && spanRef.current) openAt(spanRef.current.getBoundingClientRect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = latex
    ? <span dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="inline-math-ph">$…$</span>;

  return (
    <NodeViewWrapper as="span" className="inline-math-node" data-inline-math data-latex={latex}>
      <span
        className={'inline-math' + (editing ? ' inline-math-editing' : '')}
        ref={spanRef}
        title={latex ? `$${latex}$（双击编辑）` : '双击编辑公式'}
        onDoubleClick={openEditor}
      >
        {body}
      </span>
      {editing && rect && (
        <MathFloatEditor
          latex={latex}
          rect={rect}
          onCommit={(v) => {
            if (editor.isDestroyed) return;
            const pos = getPos();
            const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
            if (current?.type !== node.type) return;
            const value = v.trim();
            if (current.attrs.latex !== value) updateAttributes({ latex: value });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

export function RefChipView({ node }: NodeViewProps) {
  const jumpToRef = useStore((s) => s.jumpToRef);
  const computed = useStore((s) => s.computed);
  const lang = useStore((s) => s.deck.config.language);
  const kind: string = node.attrs.kind;
  const label: string = node.attrs.label;
  const fullLabel = /^\w+:/.test(label) ? label : `${kind}:${label}`;
  const parts = refParts(fullLabel);
  const display = parts ? refDisplay(parts.kind, parts.key, computed, lang) : null;
  const target = refPageIndex(fullLabel, computed);
  const cls = `xref xref-${kind}${display ? '' : ' xref-missing'}`;
  return (
    <NodeViewWrapper as="span" className="chip-node" data-ref-chip data-kind={kind} data-label={label}>
      {display ? (
        <a
          className={cls}
          href={target != null ? `#page-${target + 1}` : undefined}
          title={`${fullLabel} → 点击跳转`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); jumpToRef(fullLabel); }}
        >
          {/* 与展示态 InlineText 同构：芯片底色在 <a>、文字渐变在 .xref-t 子层 */}
          <span className="xref-t">{display}</span>
        </a>
      ) : (
        <span className={cls} title={`未找到标签 ${fullLabel}`}><span className="xref-t">{display ?? `${kind} (?)`}</span></span>
      )}
    </NodeViewWrapper>
  );
}
