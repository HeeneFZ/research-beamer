import { useEffect, useRef, useState } from 'react';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { Filmstrip } from './components/Filmstrip';
import { EditorCanvas } from './components/EditorCanvas';
import { Lightbox } from './components/Lightbox';
import { NotesPane } from './components/NotesPane';
import { PresenterView, type PresenterSnapshot } from './components/PresenterView';
import { emptyViewPreparation, presentationPreparationKey } from './model/mediaResources';
import { useBackNav } from './hooks/useBackNav';
import { useAutoSave } from './hooks/useAutoSave';
import { useMediaPreparation } from './hooks/useMediaPreparation';
import { exportPDF } from './exportPdf';
import { useStore, pageOrders } from './state/store';

export default function App() {
  useMediaPreparation();
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

  useAutoSave();

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
  const mediaRevision = useStore((s) => s.mediaRevision);
  const mediaPreparation = useStore((s) => s.mediaPreparation);
  const [editorPreparation, setEditorPreparation] = useState(emptyViewPreparation);
  const [monitorPreparation, setMonitorPreparation] = useState(emptyViewPreparation);
  const [projectionPreparation, setProjectionPreparation] = useState(emptyViewPreparation);
  const monitorSnapshot = useRef<PresenterSnapshot | null>(null);
  if (presenting) monitorSnapshot.current = { deck, computed, current, folder, revealStep, flash, mediaPreparation, mediaRevision, pageLayout, presentStart: useStore.getState().presentStart };
  else if (monitorSnapshot.current?.mediaRevision !== mediaRevision) monitorSnapshot.current = null;
  const viewPreparation = presenting ? monitorPreparation : editorPreparation;
  const projectionReady = projectionPreparation.scope === String(mediaRevision) && projectionPreparation.ready
    && (useStore.getState().presentStart > 0 || projectionPreparation.currentReady);
  const loading = mediaPreparation.phase !== 'ready' || viewPreparation.scope !== String(mediaRevision) || !viewPreparation.ready || presenting && !projectionReady;
  const projectionCurrent = presenting && projectionPreparation.scope === String(mediaRevision);
  const completed = mediaPreparation.completed + (viewPreparation.scope === String(mediaRevision) ? viewPreparation.completed : 0) + (projectionCurrent ? projectionPreparation.completed : 0);
  const total = mediaPreparation.total + (viewPreparation.scope === String(mediaRevision) ? viewPreparation.total : 0) + (projectionCurrent ? projectionPreparation.total : 0);
  const [presentNonce, setPresentNonce] = useState(0);
  const lastPresentState = useRef<{ deck: typeof deck; pageLayout: typeof pageLayout; mediaPreparation: typeof mediaPreparation; ready: number } | null>(null);
  const versions = useRef({ deck, pageLayout, mediaPreparation, deckId: 0, layoutId: 0, resourceId: 0 });
  if (versions.current.deck !== deck) { versions.current.deck = deck; versions.current.deckId++; }
  if (versions.current.pageLayout !== pageLayout) { versions.current.pageLayout = pageLayout; versions.current.layoutId++; }
  if (versions.current.mediaPreparation !== mediaPreparation) { versions.current.mediaPreparation = mediaPreparation; versions.current.resourceId++; }
  const deckVersion = `${performance.timeOrigin}:${versions.current.deckId}`;
  const layoutVersion = `${performance.timeOrigin}:${versions.current.layoutId}`;
  const resourceVersion = `${performance.timeOrigin}:${versions.current.resourceId}`;
  const expectedProjectionKey = useRef('');
  expectedProjectionKey.current = presentationPreparationKey(mediaRevision, deckVersion, layoutVersion, resourceVersion, current);
  useEffect(() => { window.api.sendPresentCtrl({ type: 'clear-project' }); }, [mediaRevision]);
  useEffect(() => { if (!presenting) setProjectionPreparation(emptyViewPreparation()); }, [presenting]);

  useEffect(() => {
    if (!presenting) { lastPresentState.current = null; return; }
    const previous = lastPresentState.current;
    // 首帧、内容变化及 ready 重播发送完整快照；导航不重复传输整份工程。
    const full = !previous || previous.deck !== deck || previous.ready !== presentNonce;
    const orders = pageOrders(computed.pages[current]);
    window.api.sendPresentState({
      ...(full ? { deck } : {}),
      folder: folder ?? '',
      mediaRevision,
      deckVersion, layoutVersion, resourceVersion,
      ...(full || previous?.mediaPreparation !== mediaPreparation ? { mediaPreparation } : {}),
      current,
      revealed: orders.slice(0, revealStep),
      flashLabel: flash?.page === current ? flash.label : undefined,
      ...(full || previous?.pageLayout !== pageLayout ? { pageLayout } : {}),
      nonce: Date.now(),
    });
    lastPresentState.current = { deck, pageLayout, mediaPreparation, ready: presentNonce };
  }, [presenting, deck, computed, current, revealStep, flash, folder, pageLayout, presentNonce, mediaRevision, mediaPreparation]);

  // 放映事件监听注册一次（handler 全部经 getState 取即时态，无闭包依赖）：
  // 结束放映后仍需收尾事件——recSaved 的「录像已保存」提示在落盘完成时才到，
  // 旧实现按 [presenting] 卸载监听会吞掉它（录制中停止→立刻结束放映场景）
  useEffect(() => {
    return window.api.onPresentEvent((evt) => {
      const s = useStore.getState();
      // 导航事件仅在放映中生效：present:close 的落盘等待窗（最长 30s）里
      // 残留的全屏放映窗仍可交互，其点击/翻页不得驱动编辑器页码与跳转栈
      if (s.presenting) {
        if (evt.type === 'advance') s.presentAdvance();
        else if (evt.type === 'skip') s.presentSkip();
        else if (evt.type === 'reverse') s.presentReverse();
        else if (evt.type === 'goto') s.gotoPage(Math.min(evt.index ?? 0, s.computed.pages.length - 1), true);
        else if (evt.type === 'ref' && evt.label) s.jumpToRef(evt.label);
        else if (evt.type === 'back') s.backJump();
      }
      if (evt.type === 'recState') useStore.setState({ presentRecording: evt.label === 'on' });
      else if (evt.type === 'preparation' && evt.label && s.presenting) {
        const progress = JSON.parse(evt.label) as ReturnType<typeof emptyViewPreparation>;
        if (progress.scope === String(s.mediaRevision) && (s.presentStart || progress.targetKey === expectedProjectionKey.current)) {
          setProjectionPreparation(progress);
          if (progress.ready && progress.currentReady && progress.targetKey === expectedProjectionKey.current && !s.presentStart) useStore.setState({ presentStart: Date.now() });
        }
      }
      else if (evt.type === 'recSaved' && evt.label) s.setFlashMsg('录像已保存 → ' + evt.label);
      else if (evt.type === 'end') s.endPresent();
      else if (evt.type === 'ready') setPresentNonce((n) => n + 1); // 放映窗就绪：重播状态
    });
  }, []);

  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <div className="main">
        {loading && <div className="project-loading" role="status"><span>{presenting ? '正在准备放映' : '正在准备工程'} {completed}/{total}</span><progress value={total ? completed : undefined} max={Math.max(1, total)} /></div>}
        <Filmstrip />
        <div className="workspace-view">
          <div className="workspace-layer editor-col" aria-hidden={presenting || undefined}
            ref={(node) => { if (node) node.inert = presenting; }} style={{ visibility: presenting ? 'hidden' : 'visible', pointerEvents: presenting ? 'none' : undefined }}>
            <EditorCanvas active={!presenting} onPreparation={setEditorPreparation} />
            <NotesPane />
          </div>
          {monitorSnapshot.current && <div className="workspace-layer" aria-hidden={!presenting || undefined}
            ref={(node) => { if (node) node.inert = !presenting; }} style={{ visibility: presenting ? 'visible' : 'hidden', pointerEvents: presenting ? undefined : 'none' }}>
            <PresenterView active={presenting} snapshot={monitorSnapshot.current} onPreparation={setMonitorPreparation} />
          </div>}
        </div>
      </div>
      {flashMsg && <div className="toast">{flashMsg}</div>}
      <Lightbox />
    </div>
  );
}
