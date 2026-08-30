// 页内 TipTap 块编辑器（移植自 EditorApp）：
// - $...$ / ￥...￥ 键入自动转行内公式芯片
// - 键入 @ 弹出交叉引用选择器（公式/图/表/节）
// - / 或 \ 弹出快捷插入菜单
// - Enter 分块、Backspace 合并、↑↓ 跨块移动（限本页文本块）
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { Block, Slide } from '../model/types';
import { useStore, slideOf } from '../state/store';
import {
  InlineMath, RefChip, ColorSpan, BgSpan, BlockKeys, bareRefKey, makePasteHandler,
  textToDoc, itemsToDoc, docToText, docToItems,
} from '../editor/schema';
import { resolveRole } from '../model/palette';
import { onOverlay } from './overlays';
import { colRegionAt } from '../model/segments';
import { insertBlockByKey, InsertKey } from './insertItems';

const SLASH_ITEMS = [
  { key: 'inline-eq', label: '行内公式', hint: '$ 或 ￥', badge: '∑', cls: 'eq' },
  { key: 'xref', label: '交叉引用', hint: '公式 / 图片 / 表格 / 节', badge: '@', cls: 'sec' },
  { key: 'color-accent', label: '着色（强调橙）', hint: '选中文本后应用', badge: '◐', cls: 'fig' },
  { key: 'color-primary', label: '着色（主色蓝）', hint: '选中文本后应用', badge: '◐', cls: 'cite' },
  { key: 'block-eq', label: '公式块', hint: '独立编号公式', badge: 'Ω', cls: 'eq' },
  { key: 'block-fig', label: '图片块', hint: '弹窗选择图片', badge: '▣', cls: 'fig' },
  { key: 'block-video', label: '视频块', hint: '弹窗选择视频', badge: '▶', cls: 'fig' },
  { key: 'block-table', label: '表格块', hint: '三线表', badge: '▦', cls: 'tab' },
  { key: 'col-mark', label: '开始双栏区', hint: '本块之后左右两栏', badge: '◫', cls: 'cite' },
  { key: 'col-end', label: '结束双栏区', hint: '本块逃出栏区回单栏', badge: '▪', cls: 'cite' },
] as const;

type SlashKey = typeof SLASH_ITEMS[number]['key'];

interface RefCandidate {
  kind: 'eq' | 'fig' | 'sec' | 'tab';
  label: string;
  desc: string;
}

/** 本页可编辑文本块（跳过栏标记/自由块不影响顺序判断） */
function textBlockNeighbors(slide: Slide) {
  return slide.blocks.filter((b) => b.type === 'paragraph' || b.type === 'itemize');
}

export function InlineBlockEditor({ slide, block }: { slide: Slide; block: Block }) {
  const updateBlock = useStore((s) => s.updateBlock);
  const insertBlock = useStore((s) => s.insertBlock);
  const deleteBlock = useStore((s) => s.deleteBlock);
  const setFocus = useStore((s) => s.setFocus);
  const focusId = useStore((s) => s.focusId);
  const focusPos = useStore((s) => s.focusPos);
  const deck = useStore((s) => s.deck);
  const computed = useStore((s) => s.computed);
  const [slash, setSlash] = useState<{ left: number; top: number } | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const [picker, setPicker] = useState<{ left: number; top: number; query: string; start: number } | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [bubble, setBubble] = useState<{ left: number; top: number } | null>(null);
  // handleDOMEvents 回调在编辑器创建时定型，弹层状态经 ref 读取避免闭包过期
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  const slashRef = useRef(slash);
  slashRef.current = slash;

  const isList = block.type === 'itemize';
  const initialContent = isList ? itemsToDoc(block.items ?? []) : textToDoc(block.text ?? '');

  const serialize = (ed: Editor): string | string[] =>
    isList ? docToItems(ed.getJSON()) : docToText(ed.getJSON());

  const editorRef = useRef<Editor | null>(null);

  // ---------- 交叉引用候选（全 deck 扫描） ----------
  const allCandidates: RefCandidate[] = useMemo(() => {
    const out: RefCandidate[] = [];
    for (const it of deck.items) {
      if (it.kind === 'section') {
        if (it.section.label) {
          out.push({ kind: 'sec', label: it.section.label, desc: `第 ${computed.sectionNumByLabel.get(it.section.label) ?? '?'} 节 ${it.section.title.slice(0, 16)}` });
        }
      } else {
        for (const b of it.slide.blocks) {
          if ((b.type === 'equation' || b.type === 'annoeq') && b.label) {
            out.push({ kind: 'eq', label: b.label, desc: `式 (${computed.equationNumByLabel.get(b.label) ?? '?'})` });
          } else if (b.type === 'figure' && b.label) {
            out.push({ kind: 'fig', label: b.label, desc: `图 ${computed.figureNumByLabel.get(b.label) ?? '?'}${b.caption ? ' ' + b.caption.slice(0, 20) : ''}` });
          } else if (b.type === 'table' && b.label) {
            out.push({ kind: 'tab', label: b.label, desc: `表 ${computed.tableNumByLabel.get(b.label) ?? '?'}${b.caption ? ' ' + b.caption.slice(0, 20) : ''}` });
          }
        }
      }
    }
    return out;
  }, [deck, computed]);

  const filtered = useMemo(() => {
    if (!picker) return allCandidates;
    const q = picker.query.toLowerCase();
    if (!q) return allCandidates;
    return allCandidates.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      `${c.kind}:${c.label}`.toLowerCase().includes(q) ||
      c.label.toLowerCase().replace(new RegExp(`^${c.kind}:`), '').includes(q));
  }, [picker, allCandidates]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, codeBlock: false, code: false,
        strike: false, horizontalRule: false, orderedList: false,
        bulletList: isList ? undefined : false,
        listItem: isList ? undefined : false,
        link: false, trailingNode: false,
      }),
      Placeholder.configure({ placeholder: isList ? '列表项' : '输入文本，/ 快捷插入，@ 交叉引用' }),
      InlineMath, RefChip, ColorSpan, BgSpan,
      BlockKeys.configure({
        handlers: {
          onSplit: (before, after) => {
            updateBlock(slide.id, block.id, { text: before });
            const id = insertBlock(slide.id, block.id, 'paragraph', { text: after });
            setFocus(id, 'start');
            return true;
          },
          onBackspaceAtStart: () => {
            // 闭包里的 slide 是编辑器创建时的快照（deck 变更后即陈旧）：邻居/合并目标
            // 一律取即时态，防「先删前块再 Backspace」合并进已删块而丢字
            const curSlide = slideOf(useStore.getState().deck, slide.id);
            if (!curSlide) return false;
            const neighbors = textBlockNeighbors(curSlide);
            const idx = neighbors.findIndex((b) => b.id === block.id);
            if (idx < 0) return false;
            const prev = neighbors[idx - 1];
            const curText = isList ? '' : (serialize(editorRef.current!) as string);
            const curEmpty = isList
              ? (serialize(editorRef.current!) as string[]).every((x) => !x.trim())
              : !curText.trim();
            if (curEmpty) {
              deleteBlock(slide.id, block.id);
              if (prev) setFocus(prev.id, 'end');
              return true;
            }
            if (prev && prev.type === 'paragraph') {
              const merged = (prev.text ?? '') + curText;
              updateBlock(slide.id, prev.id, { text: merged });
              deleteBlock(slide.id, block.id);
              setFocus(prev.id, 'end');
              return true;
            }
            return true; // 前一个是公式/图片等：阻止合并
          },
          onArrowUpAtStart: () => {
            const cur = slideOf(useStore.getState().deck, slide.id);
            if (!cur) return false;
            const neighbors = textBlockNeighbors(cur);
            const prev = neighbors[neighbors.findIndex((b) => b.id === block.id) - 1];
            if (prev) { setFocus(prev.id, 'end'); return true; }
            return false;
          },
          onArrowDownAtEnd: () => {
            const cur = slideOf(useStore.getState().deck, slide.id);
            if (!cur) return false;
            const neighbors = textBlockNeighbors(cur);
            const next = neighbors[neighbors.findIndex((b) => b.id === block.id) + 1];
            if (next) { setFocus(next.id, 'start'); return true; }
            return false;
          },
        },
      }),
    ],
    editorProps: {
      // 关闭浏览器拼写检查：contenteditable 默认启用，英文单词会出现红波浪线且绘制时引发布局抖动
      attributes: { spellcheck: 'false' },
      // Esc 退出文本编辑走 TipTap 事件管线（handleDOMEvents 在视图挂载后恒可用，
      // 不依赖 effect 时序；slash/ref 弹层打开时由它们各自的 capture 监听处理 Esc）
      handleDOMEvents: {
        keydown: (_view, ev) => {
          if (ev.key === 'Escape' && !pickerRef.current && !slashRef.current) {
            ev.preventDefault();
            useStore.getState().setEditing(null);
            return true;
          }
          return false;
        },
      },
      // 粘贴三态（行内公式保真是主目标；多行拆 hardBreak——块模型 text 支持换行）：
      // 详见 editor/schema.ts makePasteHandler
      handlePaste: makePasteHandler({ flattenNewlines: false }),
    },
    content: initialContent,
    autofocus: true,
    // 选中浮动工具条：有非空选区时锚定选区上方弹出
    onSelectionUpdate: ({ editor: e }) => {
      const { empty, $from, $to } = e.state.selection;
      if (empty) {
        setBubble(null);
        return;
      }
      const from = e.view.coordsAtPos($from.pos);
      const to = e.view.coordsAtPos($to.pos);
      const left = Math.max(8, Math.min((from.left + to.left) / 2 - 130, window.innerWidth - 280));
      const top = Math.max(8, from.top - 46);
      setBubble((b) => (b && Math.abs(b.left - left) < 1 && Math.abs(b.top - top) < 1 ? b : { left, top }));
    },
    onUpdate: ({ editor: e }) => {
      if (isList) updateBlock(slide.id, block.id, { items: serialize(e) as string[] });
      else updateBlock(slide.id, block.id, { text: serialize(e) as string });

      const { $from, empty } = e.state.selection;
      if (!empty) { setSlash(null); setPicker(null); return; }

      // @ 交叉引用选择器：光标前文本以 @query 结尾则弹出/过滤
      const textBefore = e.state.doc.textBetween(0, $from.pos);
      const atMatch = /@([A-Za-z0-9_:-]*)$/.exec(textBefore);
      if (atMatch) {
        const coords = e.view.coordsAtPos($from.pos);
        setPicker({ left: coords.left, top: coords.bottom + 4, query: atMatch[1], start: $from.pos - atMatch[0].length });
        setSelIdx(0);
        setSlash(null);
        return;
      }
      setPicker(null);

      // 斜杠菜单：行首/空白/CJK/中文标点后输入 / 或 \
      if ($from.pos > 1) {
        const before = e.state.doc.textBetween(Math.max(0, $from.pos - 1), $from.pos);
        const prevChar = $from.pos > 2 ? e.state.doc.textBetween($from.pos - 2, $from.pos - 1) : '';
        const canTrigger = !prevChar || /[\s　-鿿＀-￯]/.test(prevChar);
        if ((before === '/' || before === '\\') && canTrigger) {
          const coords = e.view.coordsAtPos($from.pos);
          setSlash({ left: coords.left, top: coords.bottom + 4 });
          setSlashIdx(0);
          return;
        }
      }
      setSlash(null);
    },
    onBlur: () => {
      setSlash(null);
      setPicker(null);
      setBubble(null);
      // 文本编辑退出通道：失焦后若编辑态仍停在本块则退出。
      // 守卫：① slash/ref 弹层 mousedown 已 preventDefault 不触发 blur；
      // ② 点到其他块会把 editing 切到目标块（blockId 不再等于本块）；
      // ③ 焦点转移到编辑器内部的 nodeview 控件（行内公式浮层等）或
      //   任何 portal 浮层，属「块内转移」，不退出。
      const myBlock = block.id;
      const ed = editorRef.current;
      window.setTimeout(() => {
        const ae = document.activeElement;
        if (ae && ed && ed.isInitialized && ed.view.dom.contains(ae)) return;
        if (onOverlay(ae)) return;
        const st = useStore.getState();
        if (st.editing?.blockId === myBlock && !st.editing.field) st.setEditing(null);
      }, 150);
    },
  }, [block.id]);
  editorRef.current = editor;

  // 聚焦请求（Enter 分块、合并、上下键移动后）
  useEffect(() => {
    if (editor && focusId === block.id) {
      editor.commands.focus(focusPos === 'start' ? 'start' : 'end');
      setFocus(null);
    }
  }, [editor, focusId, focusPos, block.id, setFocus]);

  // 外部变更（撤销）同步进编辑器（仅当未聚焦）
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = isList ? (block.items ?? []).join('\n') : (block.text ?? '');
    const inEditor = isList ? docToItems(editor.getJSON()).join('\n') : docToText(editor.getJSON());
    if (current !== inEditor) {
      editor.commands.setContent(isList ? itemsToDoc(block.items ?? []) : textToDoc(block.text ?? ''), { emitUpdate: false });
    }
  }, [editor, block.text, block.items, isList]);

  // 引用选择器打开时的键盘导航
  useEffect(() => {
    if (!picker || !editor || !editor.isInitialized) return;
    const dom = editor.view.dom as HTMLElement;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); setSelIdx((i) => Math.min(i + 1, Math.min(filtered.length, 8) - 1)); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); setSelIdx((i) => Math.max(i - 1, 0)); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') {
        ev.preventDefault(); ev.stopPropagation();
        const cand = filtered[selIdx] ?? filtered[0];
        if (cand) pickRef(cand);
      } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setPicker(null); }
    };
    dom.addEventListener('keydown', onKey, true);
    return () => dom.removeEventListener('keydown', onKey, true);
  });

  // 斜杠菜单打开时的键盘导航
  useEffect(() => {
    if (!slash || !editor || !editor.isInitialized) return;
    const dom = editor.view.dom as HTMLElement;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); setSlashIdx((i) => Math.min(i + 1, SLASH_ITEMS.length - 1)); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); setSlashIdx((i) => Math.max(i - 1, 0)); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); if (!slashDisabled(SLASH_ITEMS[slashIdx].key)) applySlash(SLASH_ITEMS[slashIdx].key); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setSlash(null); }
    };
    dom.addEventListener('keydown', onKey, true);
    return () => dom.removeEventListener('keydown', onKey, true);
  });

  // Esc 退出文本编辑 → 走 editorProps.handleDOMEvents.keydown（视图管线内恒可用）

  const pickRef = (cand: RefCandidate) => {
    if (!editor || !picker) return;
    // 候选的 label 是块上带前缀的完整标签（eq:pos）；芯片 label 必须是裸键——
    // 序列化写 [@kind:label]，直接塞完整标签会落盘 [@eq:eq:pos] 双重前缀
    editor.chain().focus()
      .deleteRange({ from: picker.start, to: editor.state.selection.$from.pos })
      .insertContent({ type: 'refChip', attrs: { kind: cand.kind, label: bareRefKey(cand.kind, cand.label) } })
      .run();
    setPicker(null);
  };

  // 结束双栏区只对栏内块有意义（与块工具栏共用 colRegionAt 判定）；
  // 键盘与鼠标两路入口都必须吃同一禁用判定（键盘漏判会走 no-op mutate：
// 幽灵撤销项 + redo 清空 + dirty 置位）
  const canColEnd = colRegionAt(slide.blocks, block.id) != null;
  const slashDisabled = (key: SlashKey): boolean => key === 'col-end' && !canColEnd;

  const applySlash = (key: SlashKey) => {
    if (!editor) return;
    setSlash(null);
    const { $from } = editor.state.selection;
    const del = () => editor.chain().focus().deleteRange({ from: $from.pos - 1, to: $from.pos });
    switch (key) {
      case 'inline-eq':
        del().insertContent({ type: 'inlineMath', attrs: { latex: '' } }).run();
        break;
      case 'xref':
        // 删除 / 并插入 @，onUpdate 会自动弹出引用选择器
        del().insertContent('@').run();
        break;
      case 'color-accent':
        del().toggleMark('colorSpan', { role: 'accent' }).run();
        break;
      case 'color-primary':
        del().toggleMark('colorSpan', { role: 'primary' }).run();
        break;
      // 块级插入统一走 insertBlockByKey（与块工具栏/首块菜单同一分发与载荷）
      case 'block-eq':
      case 'block-fig':
      case 'block-video':
      case 'block-table':
      case 'col-mark':
      case 'col-end': {
        if (slashDisabled(key)) return;
        del().run();
        const k: InsertKey = key === 'block-eq' ? 'equation'
          : key === 'block-fig' ? 'figure'
          : key === 'block-video' ? 'video'
          : key === 'block-table' ? 'table'
          : key === 'col-mark' ? 'colmark' : 'colend';
        insertBlockByKey(slide.id, block.id, k);
        break;
      }
    }
  };


  return (
    <div className="block-editor-wrap">
      <EditorContent editor={editor} />
      {slash && createPortal(
        <div className="slash-menu" style={{ position: 'fixed', left: slash.left, top: slash.top }}>
          <div className="ref-picker-title">插入（↑↓ 选择，Enter 确认）</div>
          {SLASH_ITEMS.map((it, i) => {
            const dis = slashDisabled(it.key);
            return (
              <div key={it.key} className={`slash-item${i === slashIdx ? ' sel' : ''}${dis ? ' disabled' : ''}`}
                title={dis ? '当前块不在双栏区内' : undefined}
                onMouseDown={(e) => { e.preventDefault(); if (!dis) applySlash(it.key); }}
                onMouseEnter={() => setSlashIdx(i)}>
                <span className={`ref-kind slash-badge-${it.cls}`}>{it.badge}</span>
                <span>{it.label}</span><span className="slash-hint">{dis ? '不在双栏区域内' : it.hint}</span>
              </div>
            );
          })}
        </div>,
        document.body
      )}
      {picker && createPortal(
        <div className="ref-picker" style={{ position: 'fixed', left: picker.left, top: picker.top }}>
          <div className="ref-picker-title">交叉引用（↑↓ 选择，Enter 插入）</div>
          {filtered.length === 0 && <div className="ref-picker-empty">无匹配的 label{allCandidates.length === 0 ? '（还没有带 label 的公式/图片/节）' : ''}</div>}
          {filtered.slice(0, 8).map((c, i) => (
            <div key={c.kind + c.label}
              className={`ref-picker-item${i === selIdx ? ' sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pickRef(c); }}
              onMouseEnter={() => setSelIdx(i)}>
              <span className={`ref-kind ref-kind-${c.kind}`}>{c.kind === 'eq' ? '式' : c.kind === 'fig' ? '图' : c.kind === 'tab' ? '表' : '节'}</span>
              <span className="ref-label">@{c.label}</span>
              <span className="ref-desc">{c.desc}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
      {bubble && editor && createPortal(
        // 选中文字工具条：加粗/斜体 + 文字色/底色（仅限配色角色，保持配色一致）
        <div className="bubble-bar" style={{ left: bubble.left, top: bubble.top }}
          onMouseDown={(e) => e.preventDefault()}>
          <button className={editor.isActive('bold') ? 'on' : ''} title="加粗"
            onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={editor.isActive('italic') ? 'on' : ''} title="斜体"
            onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <span className="bb-sep" />
          <span className="bb-label">文字</span>
          {(['primary', 'accent', 'emphasis'] as const).map((r) => (
            <button key={r} className={'bb-sw' + (editor.isActive('colorSpan', { role: r }) ? ' on' : '')}
              title={`文字色：${r}`} style={{ color: resolveRole(deck.config.palette, r) }}
              onClick={() => editor.chain().focus().toggleMark('colorSpan', { role: r }).run()}>A</button>
          ))}
          <button className="bb-sw bb-none" title="默认文字色"
            onClick={() => editor.chain().focus().unsetMark('colorSpan').run()}>A</button>
          <span className="bb-sep" />
          <span className="bb-label">底色</span>
          {(['primary', 'accent', 'emphasis'] as const).map((r) => (
            <button key={r} className={'bb-sw bb-bg' + (editor.isActive('bgSpan', { role: r }) ? ' on' : '')}
              title={`底色：${r}`}
              style={{ background: `color-mix(in srgb, ${resolveRole(deck.config.palette, r)} 30%, #fff)` }}
              onClick={() => editor.chain().focus().toggleMark('bgSpan', { role: r }).run()} />
          ))}
          <button className="bb-sw bb-none" title="无底色"
            onClick={() => editor.chain().focus().unsetMark('bgSpan').run()}>∅</button>
        </div>,
        document.body
      )}
    </div>
  );
}
