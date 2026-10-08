// 单行富文本字段编辑器（TipTap）：页标题 / 封面大标题 / 节名等单行字段。
// 交互与行内公式（InlineBlockEditor）同源：
// - 键入 $$ / ￥￥ 立即生成空行内公式芯片（挂载即弹 LaTeX 浮层）；$x$ / ￥x￥ 整体转芯片
// - 粘贴三态：内部芯片 HTML 原生解析 / KaTeX HTML 提取 x-tex 源重建芯片 / 纯文本 $..$ 转芯片；
//   多行拍平为空格（单行字段合约：md 属性与节标题行都存不下换行）
// - 提交时机两种：live=true 逐键即时提交（块编辑器同款，标题类用）；
//  live=false 仅在结束时提交一次（节名「新建」类一次性行动用——逐键提交会重复建节）。
//   close 模式卸载时补交；live 模式已逐键提交，不重复写入已切换的工程。
// - Enter 结束并提交；Esc 取消（live 模式回滚初值）；失焦结束（math-float 等 portal 豁免）

import { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { InlineMath, RefChip, ColorSpan, BgSpan, textToDoc, docToText, makePasteHandler } from '../editor/schema';
import { onOverlay } from './overlays';

/** 单行字段文本：\n 拍平为空格（含防御——hardBreak 已从 schema 移除，
 *  textToDoc 遇 \n 会产出未知节点导致 setContent 抛错） */
function oneLine(s: string): string {
  return s.replace(/\r?\n/g, ' ');
}

export function RichFieldEditor({ value, onCommit, onDone, onCancel, placeholder, cls, live, multiline }: {
  value: string;
  onCommit: (v: string) => void;
  /** 结束编辑（Enter / 失焦）——提交已按 live 语义处理完毕 */
  onDone: () => void;
  /** Esc 取消：live 模式已回滚初值，close 模式不产生任何提交 */
  onCancel: () => void;
  placeholder?: string;
  /** 视觉类（title-edit / sec-edit 等沿用原 input 皮肤） */
  cls?: string;
  /** 逐键即时提交（块编辑器同款）；false = 仅结束时提交一次 */
  live?: boolean;
  multiline?: boolean;
}) {
  const normalize = (text: string) => multiline ? text : oneLine(text);
  const editorRef = useRef<Editor | null>(null);
  const initialRef = useRef(normalize(value));
  const initialContent = useMemo(() => textToDoc(initialRef.current), []);
  // 回调与最新文本经 ref 取值（useEditor 选项创建时定型，闭包防陈旧）
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const liveRef = useRef(!!live);
  liveRef.current = !!live;
  const textRef = useRef(initialRef.current);
  // 会话终态：closed=已正常结束；cancelled=已取消（卸载兜底不再提交）
  const closedRef = useRef(false);
  const cancelledRef = useRef(false);

  const commitNow = (v: string) => {
    textRef.current = v;
    commitRef.current(v);
  };
  const finish = () => {
    if (closedRef.current || cancelledRef.current) return;
    closedRef.current = true;
    if (!liveRef.current || textRef.current !== initialRef.current) commitNow(textRef.current);
    doneRef.current();
  };
  const cancel = () => {
    if (closedRef.current || cancelledRef.current) return;
    cancelledRef.current = true;
    if (liveRef.current) commitNow(initialRef.current); // live 模式 Esc = 回滚初值
    cancelRef.current();
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, codeBlock: false, code: false,
        strike: false, horizontalRule: false, orderedList: false,
        bulletList: false, listItem: false, link: false, trailingNode: false,
        hardBreak: multiline ? {} : false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      InlineMath, RefChip, ColorSpan, BgSpan,
    ],
    editorProps: {
      attributes: { spellcheck: 'false' },
      handleDOMEvents: {
        keydown: (_view, ev) => {
          // 与原 <input> 字段一致：键入不外泄（全局快捷键不穿透字段）
          ev.stopPropagation();
          if (ev.isComposing || ev.keyCode === 229) return false;
          if (ev.key === 'Enter' && !(multiline && ev.shiftKey)) {
            ev.preventDefault();
            finish();
            return true;
          }
          if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
            return true;
          }
          return false;
        },
      },
      // 粘贴三态（与 InlineBlockEditor 同族 makePasteHandler；单行差异：多行拍平空格）
      handlePaste: makePasteHandler({ flattenNewlines: !multiline }),
    },
    content: initialContent,
    autofocus: 'end',
    onUpdate: ({ editor: e }) => {
      textRef.current = normalize(docToText(e.getJSON()));
      if (liveRef.current) commitRef.current(textRef.current);
    },
    onBlur: () => {
      // 公式浮层等 portal 内焦点不算离开（150ms 后取 activeElement 判定，
      // 与 InlineBlockEditor 同款守卫）
      window.setTimeout(() => {
        const ae = document.activeElement;
        const ed = editorRef.current;
        if (ae && ed && ed.isInitialized && ed.view.dom.contains(ae)) return;
        if (onOverlay(ae)) return;
        finish();
      }, 150);
    },
  }, []);
  editorRef.current = editor;

  // close 模式外部退出时补交；结束会话可阻止迟到的 blur 定时回调再次提交。
  useEffect(() => () => {
    if (!liveRef.current && !closedRef.current && !cancelledRef.current) commitRef.current(textRef.current);
    closedRef.current = true;
  }, []);

  // 外部变更（撤销等）同步进编辑器（仅未聚焦时；聚焦期间 live 提交已保证一致）
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const cur = normalize(value);
    if (cur !== normalize(docToText(editor.getJSON()))) {
      editor.commands.setContent(textToDoc(cur), { emitUpdate: false });
      textRef.current = cur;
    }
  }, [editor, value]);

  return <div className={cls}><EditorContent editor={editor} /></div>;
}
