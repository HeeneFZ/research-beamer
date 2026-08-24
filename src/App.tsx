import { useEffect, useState } from 'react';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { Filmstrip } from './components/Filmstrip';
import { EditorCanvas } from './components/EditorCanvas';
import { Lightbox } from './components/Lightbox';
import { NotesPane } from './components/NotesPane';
import { PresenterView } from './components/PresenterView';
import { useBackNav } from './hooks/useBackNav';
import { exportPDF } from './exportPdf';
import { useStore, pageOrders } from './state/store';

export default function App() {
  const darkMode = useStore((s) => s.darkMode);
  const flashMsg = useStore((s) => s.flashMsg);
  const setFlashMsg = useStore((s) => s.setFlashMsg);

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // 移除启动 splash
  useEffect(() => {
    document.getElementById('splash')?.remove();
  }, []);

  // 首次启动：加载中文示例（不存在时保持空工程）
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const m = hash.match(/example=([\w/-]+)/);
    void useStore.getState().loadExample(m ? `examples/${m[1]}` : 'examples/zh_talk');
  }, []);

  // e2e 测试钩子：暴露 store 与导出函数供自动化脚本读取状态（挂载点约定 __store）
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (window.api.isE2E) {
      w.__store = useStore;
      w.__exportPDF = exportPDF;
    }
  }, []);

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        const s = useStore.getState();
        if (s.presenting) s.endPresent();
        else void s.startPresent();
        return;
      }
      // 引用跳转后返回由 useBackNav 统一处理（Alt+← / Backspace / 鼠标侧键）
      if (!(e.ctrlKey || e.metaKey)) return;
      // 浮层打开时全局快捷键不穿透（放大镜/弹窗背后的 deck 撤销/保存看不见，属事件泄漏——
      // 与第十九轮放映窗放大镜键盘隔离同族：编辑窗的 Ctrl+Z/Y/S 通道此前漏防）
      const st0 = useStore.getState();
      if (st0.lightbox || document.querySelector('.modal-mask')) return;
      const k = e.key.toLowerCase();
      // 输入焦点（TipTap/textarea/input）内的撤销/重做归编辑器自己，全局 deck 撤销不接管
      const inField = e.target instanceof HTMLElement && !!e.target.closest('input, textarea, .ProseMirror');
      if (k === 's') {
        e.preventDefault();
        void useStore.getState().saveProject();
      } else if (k === 'z' && !e.shiftKey && !inField) {
        e.preventDefault();
        useStore.getState().undo();
      } else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !inField) {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 返回引用跳转原处（Alt+← / Backspace / 鼠标后退侧键，统一输入层）
  useBackNav(() => useStore.getState().backJump());

  // 自动保存：dirty 且已有 folder，2s 防抖；可用右上角胶囊关闭（应用级偏好）
  useEffect(() => {
    const s = useStore.getState();
    if (window.api.isE2E || !s.autoSave || !s.dirty || !s.folder) return;
    const t = setTimeout(() => {
      const st = useStore.getState();
      if (st.dirty && st.folder) void st.saveProject();
    }, 2000);
    return () => clearTimeout(t);
  });

  // flashMsg 自动消失
  useEffect(() => {
    if (!flashMsg) return;
    const t = setTimeout(() => setFlashMsg(null), 2600);
    return () => clearTimeout(t);
  }, [flashMsg, setFlashMsg]);

  // ===== 放映：状态广播 + 事件接收 =====
  const presenting = useStore((s) => s.presenting);
  const deck = useStore((s) => s.deck);
  const computed = useStore((s) => s.computed);
  const current = useStore((s) => s.current);
  const revealStep = useStore((s) => s.revealStep);
  const flash = useStore((s) => s.flash);
  const folder = useStore((s) => s.folder);
  const pageLayout = useStore((s) => s.pageLayout);
  const [presentNonce, setPresentNonce] = useState(0);

  useEffect(() => {
    if (!presenting) return;
    const orders = pageOrders(computed.pages[current]);
    window.api.sendPresentState({
      deck,
      folder: folder ?? '',
      current,
      revealed: orders.slice(0, revealStep),
      flashLabel: flash?.page === current ? flash.label : undefined,
      pageLayout,
      nonce: Date.now(),
    });
  }, [presenting, deck, computed, current, revealStep, flash, folder, pageLayout, presentNonce]);

  useEffect(() => {
    if (!presenting) return;
    return window.api.onPresentEvent((evt) => {
      const s = useStore.getState();
      if (evt.type === 'advance') s.presentAdvance();
      else if (evt.type === 'skip') s.presentSkip();
      else if (evt.type === 'reverse') s.presentReverse();
      else if (evt.type === 'goto') s.gotoPage(Math.min(evt.index ?? 0, s.computed.pages.length - 1), true);
      else if (evt.type === 'ref' && evt.label) s.jumpToRef(evt.label);
      else if (evt.type === 'back') s.backJump();
      else if (evt.type === 'recSaved' && evt.label) s.setFlashMsg('录像已保存 → ' + evt.label);
      else if (evt.type === 'end') s.endPresent();
      else if (evt.type === 'ready') setPresentNonce((n) => n + 1); // 放映窗就绪：重播状态
    });
  }, [presenting]);

  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <div className="main">
        <Filmstrip />
        {presenting ? (
          <PresenterView />
        ) : (
          <div className="editor-col">
            <EditorCanvas />
            <NotesPane />
          </div>
        )}
      </div>
      {flashMsg && <div className="toast">{flashMsg}</div>}
      <Lightbox />
    </div>
  );
}
