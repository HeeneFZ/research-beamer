// 无边框窗口菜单栏（可拖动）+ 工程路径 + 自绘窗口按钮
import { exportPDF } from '../exportPdf';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { promptText } from './prompt';
import { Page } from '../model/types';

interface MenuDef {
  title: string;
  items: (
    | { kind: 'item'; label: string; hint?: string; disabled?: boolean; on(): void }
    | { kind: 'sep' }
  )[];
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // 按需订阅（整店订阅会让每次击键/排版扫描写入都重渲菜单栏）；动作经 getState() 调用
  const computed = useStore((st) => st.computed);
  const current = useStore((st) => st.current);
  const presenting = useStore((st) => st.presenting);
  const darkMode = useStore((st) => st.darkMode);
  const autoSave = useStore((st) => st.autoSave);
  const folder = useStore((st) => st.folder);
  const dirty = useStore((st) => st.dirty);
  const page = computed.pages[current];
  const editableSlide = page?.kind === 'slide' && page.slide ? page.slide : undefined;
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as globalThis.Node)) setOpen(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const promptSection = async (level: 1 | 2 | 3) => {
    if (!editableSlide) return;
    const t = await promptText(level === 1 ? '节标题' : level === 2 ? '小节标题' : '子小节标题', '');
    if (t && t.trim()) useStore.getState().addSectionBefore(editableSlide.id, t.trim(), level);
  };

  const menus: MenuDef[] = [
    {
      title: '文件',
      items: [
        { kind: 'item', label: '新建工程', on: () => useStore.getState().newProject() },
        { kind: 'item', label: '打开工程…', on: () => { void useStore.getState().openProject(); } },
        { kind: 'item', label: '保存', hint: 'Ctrl+S', on: () => { void useStore.getState().saveProject(); } },
        { kind: 'sep' },
        { kind: 'item', label: '导出 PDF…', on: () => { void exportPDF(); } },
      ],
    },
    {
      title: '放映',
      items: [
        { kind: 'item', label: presenting ? '结束放映' : '从当前页开始放映', hint: 'F5', on: () => { const st = useStore.getState(); st.presenting ? st.endPresent() : void st.startPresent(); } },
        { kind: 'item', label: '下一页（含动画步进）', on: () => useStore.getState().presentAdvance() },
        { kind: 'item', label: '上一页', on: () => useStore.getState().presentReverse() },
        { kind: 'item', label: '返回跳转（鼠标后退键/Alt+←）', on: () => useStore.getState().backJump() },
      ],
    },
    {
      title: '页面',
      items: [
        { kind: 'item', label: '新建内容页', on: () => useStore.getState().addSlide('content', current) },
        { kind: 'item', label: '新建双栏页', on: () => useStore.getState().addSlide('twoCol', current) },
        { kind: 'item', label: '新建结尾页', on: () => useStore.getState().addSlide('end', current) },
        { kind: 'sep' },
        { kind: 'item', label: '复制当前页', disabled: !editableSlide, on: () => editableSlide && useStore.getState().duplicateSlide(editableSlide.id) },
        { kind: 'item', label: '删除当前页', disabled: !editableSlide, on: () => editableSlide && useStore.getState().deleteSlide(editableSlide.id) },
        { kind: 'sep' },
        { kind: 'item', label: '添加节标题', disabled: !editableSlide, on: () => { void promptSection(1); } },
        { kind: 'item', label: '添加小节标题', disabled: !editableSlide, on: () => { void promptSection(2); } },
        { kind: 'item', label: '添加子小节标题', disabled: !editableSlide, on: () => { void promptSection(3); } },
      ],
    },
    {
      title: '视图',
      items: [
        { kind: 'item', label: darkMode ? '亮色模式' : '暗色模式', on: () => useStore.getState().toggleDarkMode() },
        { kind: 'item', label: '放大', hint: 'Ctrl+滚轮', on: () => useStore.getState().setZoom(useStore.getState().zoom * 1.15) },
        { kind: 'item', label: '缩小', on: () => useStore.getState().setZoom(useStore.getState().zoom / 1.15) },
        { kind: 'item', label: '重置缩放', on: () => useStore.getState().setZoom(1) },
        { kind: 'sep' },
      ],
    },
  ];

  return (
    <div className="menubar" ref={barRef}>
      <img className="app-logo" src="./icon.png" alt="" />
      <span className="app-name">Research Beamer</span>
      {menus.map((m) => (
        <div className="menu" key={m.title}>
          <button
            className={'menu-title' + (open === m.title ? ' open' : '')}
            onClick={() => setOpen(open === m.title ? null : m.title)}
            onMouseEnter={() => { if (open) setOpen(m.title); }}
          >
            {m.title}
          </button>
          {open === m.title && (
            <div className="menu-drop">
              {m.items.map((it, i) =>
                it.kind === 'sep' ? (
                  <div className="menu-sep" key={i} />
                ) : (
                  <div
                    key={i}
                    className={'menu-item' + (it.disabled ? ' disabled' : '')}
                    onClick={() => {
                      if (it.disabled) return;
                      setOpen(null);
                      it.on();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.hint && <span className="menu-hint">{it.hint}</span>}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-mid">
        <span
          className="tb-path"
          title={folder ?? undefined}
          onClick={() => { if (folder) void window.api.showItem(folder); }}
        >
          {folder || '未保存工程'}
        </span>
        {dirty ? <span className="dirty-dot" title="有未保存更改" /> : null}
      </div>
      {/* 自动保存切换胶囊（应用级偏好，localStorage 持久化） */}
      <button
        className={'save-pill' + (autoSave ? ' on' : '')}
        title={autoSave ? '自动保存已开启（点击关闭，改用手动 Ctrl+S）' : '自动保存已关闭（点击开启）'}
        onClick={() => useStore.getState().toggleAutoSave()}
      >
        {autoSave ? '自动保存' : '手动保存'}
      </button>
      <div className="win-controls">
        <button className="win-btn" onClick={() => window.api.winMin()} title="最小化">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
        </button>
        <button className="win-btn" onClick={() => window.api.winMax()} title="最大化">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
        </button>
        <button className="win-btn win-close" onClick={() => window.api.winClose()} title="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
        </button>
      </div>
    </div>
  );
}
