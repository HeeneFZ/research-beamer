// 放映窗口根组件（#present 独立 BrowserWindow，全屏于副屏）
// - 挂载即发 ready 握手（编辑器收到后重播状态）
// - 键盘/鼠标/滚轮导航；激光笔；黑白屏；图片放大查看（Lightbox）
// - 局部放大（PowerPoint 放大镜式）：按 Z/控件按钮进入透镜模式——四分之一页大小的
//   选区窗口跟随鼠标，点击即放大该区域；放大态拖拽平移；Esc/0 复位。Ctrl+滚轮自由缩放
// - G 或网格按钮：全页浏览（缩略图墙，点击跳转）
// - 控件条：锚定在【放映页面】左下角（非屏幕左下角），鼠标移动渐显、闲置淡出

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Deck, Page, PAGE_SIZE } from './model/types';
import { Computed, computeDeck } from './model/numbering';
import { SlideView } from './components/SlideView';
import { ReadySlideStage } from './components/ReadySlideStage';
import { useScreenPreparation } from './hooks/useScreenPreparation';
import { LightboxInner } from './components/Lightbox';
import { MediaPreparation, emptyMediaPreparation, emptyViewPreparation, presentationPreparationKey } from './model/mediaResources';
import { clearDecodedRasters } from './components/resourceRaster';
import { clearGifAnimations } from './components/GifAnimation';
import { releaseUnusedPdfDocuments } from './components/pdfRaster';
import { rememberEpsTarget, rememberMediaAspect } from './model/mediaGeometry';
import { realignKatexRules } from './components/katexRuleSnap';
import { useBackNav } from './hooks/useBackNav';
import { useStore } from './state/store';
import { setMediaRevision } from './model/mediaGeometry';
import { PageLayout } from './model/layoutSpec';
import 'katex/dist/katex.min.css';
import './styles.css';

interface PresentState {
  deck: Deck;
  folder: string;
  mediaRevision: number;
  presentSession?: string;
  mediaPreparation?: MediaPreparation;
  current: number;
  revealed: number[];
  flashLabel?: string;
  /** 页级排版状态（编辑器窗扫描产物；放映窗据此渲染，保证两边一致） */
  pageLayout?: Record<string, PageLayout>;
  nonce: number;
  deckVersion?: string;
  layoutVersion?: string;
  resourceVersion?: string;
}

type PresentStateUpdate = Omit<PresentState, 'deck'> & { deck?: Deck };

interface PresentEvent {
  type: string;
  index?: number;
  label?: string;
  session?: string;
}

const LASER_COLORS = ['#ff2d2d', '#2dff6a', '#2db8ff', '#ffd62d'];
const LENS_ZOOM = 2.2;

type ZoomState = {
  mode: 'free';
  z: number;
  ox: number; oy: number;      // 缩放中心（页面百分比 0–1）
  panX: number; panY: number;  // 拖拽平移（屏幕 px）
} | { mode: 'lens' };          // 透镜选区模式（跟随鼠标的 1/4 页选框）

const FREE1: ZoomState = { mode: 'free', z: 1, ox: 0.5, oy: 0.5, panX: 0, panY: 0 };

/** 控件条 SVG 图标（16×16，currentColor，风格统一） */
const I = {
  prev: <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  next: <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  lens: (<>
    <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10.3 10.3 13.6 13.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </>),
  zoomOut: <path d="M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  zoomIn: <path d="M4 8h8M8 4v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  reset: (<>
    <path d="M13 8A5 5 0 1 1 8 3c1.9 0 3.5 1 4.3 2.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M12.9 2.4v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  grid: (<>
    <rect x="2.2" y="2.2" width="4.8" height="4.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9" y="2.2" width="4.8" height="4.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <rect x="2.2" y="9" width="4.8" height="4.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9" y="9" width="4.8" height="4.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </>),
  laser: (<>
    <circle cx="8" cy="8" r="2.3" fill="currentColor" />
    <path d="M8 1.3v2.2M8 12.5v2.2M1.3 8h2.2M12.5 8h2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </>),
  blank: <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  swap: (<>
    <rect x="1.5" y="1.5" width="6.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="8" y="10" width="6.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2 12.3h5.2M6 10.7l1.6 1.6L6 13.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 3.7H8.8M10 2.1 8.4 3.7l1.6 1.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  record: <circle cx="8" cy="8" r="4.5" fill="currentColor" />,
  close: <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
};

function PIcon({ children }: { children: React.ReactNode }) {
  return <svg width="16" height="16" viewBox="0 0 16 16">{children}</svg>;
}

export default function Present() {
  const [st, setSt] = useState<PresentState | null>(null);
  const stateRef = useRef<PresentState | null>(null);
  const awaitingSnapshot = useRef(true);
  const expectedSession = useRef<string | undefined>();
  const suspended = useRef(false);
  const sourceOwner = useRef(0);
  const cleared = useRef<{ owner: string; revision: number } | null>(null);
  const [sessionActive, setSessionActive] = useState(true);
  const [awaitingState, setAwaitingState] = useState(true);
  const [bootReady, setBootReady] = useState(false);
  const [stagePreparation, setStagePreparation] = useState(emptyViewPreparation);
  const [laser, setLaser] = useState(false);
  const [laserColorIdx, setLaserColorIdx] = useState(0);
  const [zoomState, setZoomState] = useState<ZoomState>(FREE1);
  const mouse = useRef({ x: 0.5, y: 0.5 });
  const lensRef = useRef<HTMLDivElement>(null);
  const lensGeometry = useRef({ left: 0, top: 0, width: 0, height: 0 });
  const [blank, setBlank] = useState<null | 'black' | 'white'>(null);
  const [sorter, setSorter] = useState(false);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [ctrlHover, setCtrlHover] = useState(false);
  const screenReady = useRef(false);
  const laserDot = useRef<HTMLDivElement>(null);
  const zsRef = useRef(zoomState);
  zsRef.current = zoomState;
  const sorterRef = useRef(sorter);
  sorterRef.current = sorter;
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; panX2: number; panY2: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 拖拽直写上下文（渲染期刷新，与 zsRef 同款）：拖平移不 setState，transform 直写
  // .present-page，mouseup 一次提交终值——每帧重渲染放映页树（annoeq 序列化）不可接受
  const dragCtx = useRef({ z: 1, ox: 0.5, oy: 0.5, shownW: 0, shownH: 0 });
  const presentPageRef = useRef<HTMLDivElement>(null);
  // 拖拽平移后的 click 事件在 mouseup 之后才到——dragRef 已清空，用独立标记抑制误翻页
  const suppressClick = useRef(false);
  // 放映窗的 lightbox 用本地状态；本窗 store 仅承载 pageLayout（编辑器窗扫描产物，见下方 onPresentState）
  const [lightbox, setLightbox] = useState<{ abs: string; ext: string; caption?: string } | null>(null);

  // ---- 放映录制（60Hz 屏幕画面 + 系统声音 loopback + 麦克风人声混音 → webm） ----
  const [recording, setRecording] = useState(false);
  const [recErr, setRecErr] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // 启动互斥：getDisplayMedia/getUserMedia 是异步的，recorderRef 要到构造完成才非空——
  // 双击/连点两次 rec-toggle 会看到空 ref 走两条采集流，第二条覆盖 ref 后第一条
  // 永不停（屏幕采集指示灯常亮）且两路分片写进同一数组（webm 损坏）
  const recStartingRef = useRef(false);
  const recGenerationRef = useRef(0);
  const activeSessionRef = useRef(true);

  const stopRecording = () => {
    recGenerationRef.current++; recStartingRef.current = false;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    if (rec) window.api.sendPresentEvent({ type: 'recState', label: 'off', session: stateRef.current?.presentSession });
    recorderRef.current = null;
    setRecording(false);
  };

  const startRecording = async () => {
    const snapshot = stateRef.current;
    const session = expectedSession.current;
    if (!snapshot || awaitingSnapshot.current || snapshot.presentSession !== session || !activeSessionRef.current || !screenReady.current || recStartingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    const generation = ++recGenerationRef.current;
    const owner = snapshot.deckVersion?.split(':')[0];
    const valid = () => activeSessionRef.current && recGenerationRef.current === generation && expectedSession.current === session
      && stateRef.current?.mediaRevision === snapshot.mediaRevision && stateRef.current?.deckVersion?.split(':')[0] === owner;
    recStartingRef.current = true;
    setRecErr(null);
    let disp: MediaStream | null = null, mic: MediaStream | null = null, ctx: AudioContext | null = null;
    let ownedByRecorder = false;
    const releaseCapture = () => {
      disp?.getTracks().forEach((track) => track.stop()); mic?.getTracks().forEach((track) => track.stop());
      if (ctx && ctx.state !== 'closed') void ctx.close();
    };
    try {
      // 放映窗口合成帧 + 系统声音；窗口捕获不依赖显示器的缩放和交换顺序。
      disp = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } },
        audio: true,
      });
      if (!valid()) return;
      // 麦克风人声：失败（无麦/拒绝）不阻断录制——系统声已可用
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch { /* 无麦克风或被拒绝：仅系统声 */ }
      if (!valid()) return;
      // 混音：WebAudio 声明周期与 recorder 绑定，停止时一并断开
      const tracks = [disp.getVideoTracks()[0]];
      ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      let mixed = false;
      if (disp.getAudioTracks().length) {
        ctx.createMediaStreamSource(new MediaStream([disp.getAudioTracks()[0]])).connect(dest);
        mixed = true;
      }
      if (mic) {
        ctx.createMediaStreamSource(mic).connect(dest);
        mixed = true;
      }
      const stream = mixed
        ? new MediaStream([...tracks, ...dest.stream.getAudioTracks()])
        : new MediaStream(tracks);
      const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
      // 分片数组闭包在本 recorder 生命周期内（共享 ref 会让快速重启时上一录的
      // 晚到分片混进新录，交错损坏 webm）
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        let saveError: string | undefined;
        try {
          const blob = new Blob(chunks, { type: mime || 'video/webm' });
          // 释放采集设备
          stream.getTracks().forEach((t) => t.stop());
          releaseCapture();
          if (blob.size === 0) return;
          const ts = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const name = `rec-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}-${crypto.randomUUID()}.webm`;
          const buf = await blob.arrayBuffer();
          const r = await window.api.saveRecording({ folder: snapshot.folder || null, name, data: buf });
          if (r && !r.error) window.api.sendPresentEvent({ type: 'recSaved', label: r.path } as unknown as PresentEvent);
          else if (r && r.error) { saveError = '录像保存失败：' + r.error; setRecErr(saveError); }
        } catch (e) {
          saveError = '录像保存失败：' + String(e); setRecErr(saveError);
        } finally {
          // 落盘完成 ack（成功/失败/空块全路径）：present:close 等此信号再关窗，
          // 否则停止录制后立刻结束放映会在序列化途中销毁本窗 → 录像静默丢失
          window.api.sendPresentEvent({ type: 'recStopped', label: saveError });
        }
      };
      // 用户从浏览器级「停止共享」栏结束录制（不经控件按钮）
      disp.getVideoTracks()[0].addEventListener('ended', () => {
        if (recorderRef.current === rec && rec.state !== 'inactive') stopRecording();
      });
      recorderRef.current = rec;
      rec.start(1000); // 1s 分片：长录制内存峰值受控
      window.api.sendPresentEvent({ type: 'recState', label: 'on', session });
      ownedByRecorder = true;
      setRecording(true);
    } catch (e) {
      if (valid()) setRecErr('录制启动失败：' + String(e));
    } finally {
      if (!ownedByRecorder) releaseCapture();
      if (recGenerationRef.current === generation) recStartingRef.current = false;
    }
  };

  // 最新「录制开关」函数（mount 时 effect 闭包经此取到当前渲染的 start/stop：
  // mount 时 st=null，直捕首帧闭包会把录像存到 folder=null 的错误位置）
  const recCtlRef = useRef<() => void>(() => {});
  recCtlRef.current = () => {
    if (recStartingRef.current || recorderRef.current && recorderRef.current.state !== 'inactive') stopRecording();
    else void startRecording();
  };

  useEffect(() => {
    // 同步编辑器窗的页级排版状态到本窗 store（SlideView 从本窗 store 读取排版变量）
    const off = window.api.onPresentState((p: unknown) => {
      const ps = p as PresentStateUpdate;
      if (expectedSession.current && ps.presentSession !== expectedSession.current) return;
      if (awaitingSnapshot.current && !ps.deck) return;
      const previous = stateRef.current;
      const owner = ps.deckVersion?.split(':')[0] ?? '';
      const ownerEpoch = Number(owner);
      if (ownerEpoch < sourceOwner.current) return;
      sourceOwner.current = ownerEpoch;
      if (cleared.current?.owner === owner && ps.mediaRevision < cleared.current.revision) return;
      if (previous?.deckVersion?.split(':')[0] === owner && ps.mediaRevision < previous.mediaRevision) return;
      if (!previous && !ps.deck) return;
      const changedProject = previous?.mediaRevision !== ps.mediaRevision || previous?.deckVersion?.split(':')[0] !== owner;
      const changedOwner = previous?.deckVersion?.split(':')[0] !== owner;
      setMediaRevision(ps.mediaRevision, changedOwner);
      if (changedProject) {
        screenReady.current = false;
        stopRecording();
        setBootReady(false);
        clearDecodedRasters();
        if (changedOwner) clearGifAnimations();
        clearGifAnimations(ps.mediaRevision); releaseUnusedPdfDocuments(changedOwner);
      }
      const same = (key: 'deckVersion' | 'layoutVersion' | 'resourceVersion') => !changedProject && !!ps[key] && ps[key] === previous?.[key];
      const pageLayout = same('layoutVersion') ? previous?.pageLayout : ps.pageLayout ?? previous?.pageLayout ?? {};
      const mediaPreparation = same('resourceVersion') ? previous?.mediaPreparation : ps.mediaPreparation ?? previous?.mediaPreparation;
      const revealed = previous && previous.revealed.length === ps.revealed.length && previous.revealed.every((order, i) => order === ps.revealed[i]) ? previous.revealed : ps.revealed;
      const next: PresentState = { ...ps, deck: same('deckVersion') ? previous!.deck : ps.deck ?? previous!.deck, pageLayout, mediaPreparation, revealed };
      stateRef.current = next;
      expectedSession.current = ps.presentSession;
      useStore.setState({ pageLayout, mediaRevision: ps.mediaRevision, ...(mediaPreparation ? { mediaPreparation } : {}) });
      if (mediaPreparation) for (const [abs, target] of Object.entries(mediaPreparation.epsTargets ?? {})) rememberEpsTarget(abs, target, ps.mediaRevision);
      if (mediaPreparation) for (const [abs, resource] of Object.entries(mediaPreparation.resources)) rememberMediaAspect(abs, resource.aspect);
      awaitingSnapshot.current = false;
      setSt(next); setAwaitingState(false);
      if (!suspended.current) { activeSessionRef.current = true; setSessionActive(true); }
    });
    window.api.sendPresentEvent({ type: 'ready' });
    // 放映台（主窗 PresenterView）与主进程（结束放映先停录）的控制命令：
    // 录制设备在本窗持有，跨窗经 present:ctrl 转发。经 ref 取最新闭包——
    // mount 时 st=null，直捕首帧 startRecording 会把录像存到 folder=null 的错误位置
    const offCtrl = window.api.onPresentCtrl((c) => {
      if (c.type === 'rec-toggle') recCtlRef.current();
      // 主进程结束放映前的停录命令（present:close 检测到录制中先停录再关窗）
      else if (c.type === 'rec-stop') stopRecording();
      else if (c.type === 'suspend') {
        if (c.session && expectedSession.current && c.session !== expectedSession.current) return;
        screenReady.current = false;
        suspended.current = true; activeSessionRef.current = false; stopRecording(); setSessionActive(false);
        if (c.closeGeneration != null) window.api.sendPresentEvent({ type: 'suspended', label: String(c.closeGeneration), session: c.session });
      }
      else if (c.type === 'resume') {
        screenReady.current = false;
        expectedSession.current = c.session ?? stateRef.current?.presentSession;
        suspended.current = false;
        awaitingSnapshot.current = true;
        stopRecording(); activeSessionRef.current = true;
        setSessionActive(true); setAwaitingState(true); setBootReady(false);
        setZoomState(FREE1); setBlank(null); setSorter(false); setLaser(false); setLightbox(null); setRecErr(null);
        dragRef.current = null; suppressClick.current = false; setDragging(false); mouse.current = { x: 0.5, y: 0.5 };
      } else if (c.type === 'clear-project') {
        const current = stateRef.current;
        const owner = c.owner ?? current?.deckVersion?.split(':')[0] ?? '';
        if (c.mediaRevision == null) return;
        const ownerEpoch = Number(owner);
        if (ownerEpoch < sourceOwner.current) return;
        sourceOwner.current = ownerEpoch;
        if (current?.deckVersion?.split(':')[0] === owner && c.mediaRevision <= current.mediaRevision) return;
        if (cleared.current?.owner === owner && c.mediaRevision < cleared.current.revision) return;
        cleared.current = { owner, revision: c.mediaRevision };
        screenReady.current = false;
        awaitingSnapshot.current = true;
        activeSessionRef.current = false; stopRecording();
        setSessionActive(false); setAwaitingState(true); setBootReady(false);
        stateRef.current = null; setSt(null); clearDecodedRasters(); clearGifAnimations(); releaseUnusedPdfDocuments(true);
        useStore.setState({ pageLayout: {}, mediaPreparation: emptyMediaPreparation() });
      }
    });
    return () => { off(); offCtrl(); };
  }, []);


  // 卸载守卫：放映窗直接关闭时停掉录制（closed 前 stop，onstop 落盘链路仍可用）
  useEffect(() => () => {
    activeSessionRef.current = false; recGenerationRef.current++; recStartingRef.current = false;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    document.getElementById('splash')?.remove();
  }, []);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 缩放重绘只处理当前可见页；平移不改变字形和公式的绘制分辨率。
  // 线的设备像素下限随绘制倍率变化；等待当前页布局提交后重算。
  const rasterZoom = zoomState.mode === 'free' ? zoomState.z : 1;
  useEffect(() => {
    const root = presentPageRef.current?.querySelector<HTMLElement>('[data-stage-visible]');
    if (root) realignKatexRules(root);
    const t = window.setTimeout(() => {
      const visible = presentPageRef.current?.querySelector<HTMLElement>('[data-stage-visible]');
      if (visible) realignKatexRules(visible);
      window.dispatchEvent(new Event('raster-scale'));
    }, 50);
    return () => clearTimeout(t);
  }, [rasterZoom, st?.current, sessionActive]);

  const send = useCallback((evt: PresentEvent) => {
    if (!screenReady.current && ['advance', 'reverse', 'skip', 'goto', 'ref', 'back'].includes(evt.type)) return;
    window.api.sendPresentEvent({ ...evt, session: expectedSession.current ?? stateRef.current?.presentSession });
  }, []);

  const onRef = useCallback((label: string) => send({ type: 'ref', label }), [send]);
  const onSlideJump = useCallback((index: number) => send({ type: 'goto', index }), [send]);
  const onZoom = useCallback((abs: string, ext: string, caption?: string) => setLightbox({ abs, ext, caption }), []);
  const revealed = useMemo(() => new Set(st?.revealed ?? []), [st?.revealed]);

  const computed: Computed | null = useMemo(() => (st ? computeDeck(st.deck) : null), [st?.deck]);

  const displayAspect = st?.deck.config.aspect === '4:3' ? 4 / 3 : 16 / 9;
  const displayWidth = Math.min(vp.w, vp.h * displayAspect);
  const logicalWidth = PAGE_SIZE[st?.deck.config.aspect ?? '16:9'].w * 96 / 25.4;
  const stateOwner = st?.deckVersion?.split(':')[0] ?? '';
  const screen = useScreenPreparation(computed?.pages ?? [], st?.current ?? 0, st?.folder ?? '', st?.mediaPreparation, displayWidth * rasterZoom, displayWidth / displayAspect * rasterZoom, sessionActive, logicalWidth, false, true, stateOwner);
  const requestedPreparationKey = st ? presentationPreparationKey(st.mediaRevision, st.deckVersion, st.layoutVersion, st.resourceVersion, st.current) : '';
  useEffect(() => {
    if (sessionActive && !awaitingState && screen.ready && (computed?.pages.length === 0 || stagePreparation.targetKey === requestedPreparationKey && stagePreparation.ready && stagePreparation.currentReady)) setBootReady(true);
  }, [sessionActive, awaitingState, bootReady, screen.ready, stagePreparation, requestedPreparationKey, computed?.pages.length]);
  screenReady.current = sessionActive && bootReady;
  useEffect(() => {
    if (!sessionActive || !st) return;
    window.api.sendPresentEvent({ type: 'preparation', session: st.presentSession, label: JSON.stringify({ scope: String(st.mediaRevision), targetKey: requestedPreparationKey,
      ready: bootReady && !awaitingState, currentReady: computed?.pages.length === 0 || stagePreparation.currentReady,
      completed: stagePreparation.completed, total: stagePreparation.total }) });
  }, [sessionActive, st?.mediaRevision, requestedPreparationKey, bootReady, awaitingState, computed?.pages.length, stagePreparation.currentReady, stagePreparation.completed, stagePreparation.total, screen.completed, screen.total]);
  // 返回引用跳转原处（Alt+← / Backspace / 鼠标后退侧键，与编辑器共用输入层）
  useBackNav(useCallback(() => send({ type: 'back' }), [send]));

  const resetZoom = () => setZoomState(FREE1);

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const z = zsRef.current;
      // 放大镜打开时键盘全部归 LightboxInner 自理（Esc/+/-/0/双击重置）——
      // 否则方向键/空格/G/B/+/- 会穿透到背后页面（与滚轮泄漏同族）
      if (lightbox) return;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'Enter' || k === 'n') {
        if (sorterRef.current) return;
        e.preventDefault();
        if (z.mode !== 'free' || z.z > 1) return;
        send({ type: 'advance' });
      } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'p') {
        if (sorterRef.current) return;
        e.preventDefault();
        send({ type: 'reverse' });
      } else if (k === 'PageDown') {
        e.preventDefault();
        send({ type: 'skip' });
      } else if (k === 'PageUp') {
        e.preventDefault();
        send({ type: 'reverse' });
      } else if (k === 'Home') {
        send({ type: 'goto', index: 0 });
      } else if (k === 'End') {
        send({ type: 'goto', index: 1e9 });
      } else if (k === '+' || k === '=') {
        setZoomState((s) => (s.mode === 'free' ? { ...s, z: Math.min(8, s.z * 1.25) } : s));
      } else if (k === '-') {
        setZoomState((s) => (s.mode === 'free' ? (s.z <= 1.05 ? FREE1 : { ...s, z: Math.max(1, s.z / 1.25) }) : s));
      } else if (k === '0') {
        resetZoom();
      } else if (k === 'z' || k === 'Z') {
        // 透镜选区放大（PowerPoint 放大镜式）
        setZoomState((s) => (s.mode === 'lens' ? FREE1 : { mode: 'lens' }));
      } else if (k === 'g' || k === 'G') {
        setSorter((v) => !v);
      } else if (k === 'l' || k === 'L') {
        setLaser((v) => !v);
      } else if (k === 'c' || k === 'C') {
        setLaserColorIdx((i) => (i + 1) % LASER_COLORS.length);
      } else if (k === 'b' || k === 'B') {
        setBlank((v) => (v === 'black' ? null : 'black'));
      } else if (k === 'w' || k === 'W') {
        setBlank((v) => (v === 'white' ? null : 'white'));
      } else if (k === 'Escape') {
        if (sorterRef.current) setSorter(false);
        else if (zsRef.current.mode === 'lens') resetZoom();
        else if (zsRef.current.mode === 'free' && zsRef.current.z > 1) resetZoom();
        else if (laser) setLaser(false);
        else if (blank) setBlank(null);
        else send({ type: 'end' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send, laser, blank, lightbox]);

  // 鼠标跟随和放大平移每帧最多写一次，不触发页面 React 重渲染。
  useEffect(() => {
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const paintPointer = () => {
      frame = 0;
      const e = pointer;
      if (zsRef.current.mode === 'lens' && lensRef.current) {
        const c = lensGeometry.current;
        const x = Math.max(0, Math.min(e.x - c.left - c.width / 4, c.width / 2));
        const y = Math.max(0, Math.min(e.y - c.top - c.height / 4, c.height / 2));
        lensRef.current.style.transform = `translate(${x}px, ${y}px)`;
      }
      const dot = laserDot.current;
      if (dot) dot.style.transform = `translate(${e.x}px, ${e.y}px)`;
      const d = dragRef.current, c = dragCtx.current, el = presentPageRef.current;
      if (d && el && c.shownW > 0 && c.z > 1) {
        const tX = -c.ox * (c.z - 1) * c.shownW + d.panX2;
        const tY = -c.oy * (c.z - 1) * c.shownH + d.panY2;
        el.style.transform = `translate(${tX}px, ${tY}px)`;
      }
    };
    const onMove = (e: MouseEvent) => {
      // mouse 态仅透镜选框消费（激光点走 ref 直写、拖拽走 dragRef）：
      // 非透镜态不 setState，鼠标移动零重渲染（放映页含 annoeq 每帧序列化不可接受）
      if (zsRef.current.mode === 'lens') {
        mouse.current = { x: e.clientX / Math.max(1, vp.w), y: e.clientY / Math.max(1, vp.h) };
      }
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(paintPointer);
      const d = dragRef.current;
      if (!d) return;
      // 越窗丢 mouseup 自愈：按钮已松（buttons===0）时按 onUp 同款收尾
      if (e.buttons === 0) { finishDrag(); return; }
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      d.panX2 = d.panX + dx;
      d.panY2 = d.panY + dy;
      // 平移直写 transform（不 setState，零重渲染）；mouseup 一次提交终值。
      // z≤1 不写：中途 Esc/0 复位缩放后 React 已写回复位 transform，
      // 此处再写 pan 会把复位覆盖掉且无人恢复（React props 比较见同值跳过写回）
    };
    /** 拖拽收尾（onUp 与越窗自愈共用）：suppressClick 闩带 350ms 超时兜底
     *  （mouseup 落在窗外时无 click 跟随，闩不清理会吞掉下一次真点击）；
     *  仅 z>1 时提交 pan——中途 Esc/0 复位到 z=1 后 pan 无意义且会留下偏移页 */
    const finishDrag = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!d) return;
      if (d.moved) {
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 350);
      }
      if (d.moved && zsRef.current.mode === 'free' && zsRef.current.z > 1
        && (d.panX2 !== d.panX || d.panY2 !== d.panY)) {
        setZoomState((s) => (s.mode === 'free' && s.z > 1 ? { ...s, panX: d.panX2, panY: d.panY2 } : s));
      }
    };
    const onDown = (e: MouseEvent) => {
      // 放大态（自由缩放 z>1）：左键拖拽 = 平移
      const z = zsRef.current;
      const target = e.target instanceof Element ? e.target : null;
      if (activeSessionRef.current && !target?.closest('.pctrl, .lb-overlay, .sorter-overlay, button, a, video') && e.button === 0 && z.mode === 'free' && z.z > 1) {
        dragRef.current = { x: e.clientX, y: e.clientY, panX: z.panX, panY: z.panY, panX2: z.panX, panY2: z.panY, moved: false };
        setDragging(true);
      }
    };
    const onUp = (e: MouseEvent) => {
      finishDrag();
      // button 3（后退）由 useBackNav 统一处理；button 4（前进）= 下一步
      // 放大镜内的事件不穿透（与键盘/滚轮同族守卫）
      if (e.button === 4) {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('.lb-overlay')) return;
        send({ type: 'advance' });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [vp, send]);

  const rootRef = useRef<HTMLDivElement>(null);

  // 滚轮：React 18 的 onWheel 是 passive 监听（preventDefault 静默无效且控制台报错），
  // 必须原生非 passive 绑定。Ctrl+滚轮自由缩放；普通滚轮翻页；放大镜/全页浏览时归它们自理
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (sorter || lightbox) return;
      if (e.ctrlKey) {
        e.preventDefault();
        setZoomState((s) => {
          if (s.mode !== 'free') return s;
          const nz = Math.min(8, Math.max(1, s.z * (e.deltaY < 0 ? 1.15 : 0.87)));
          return nz <= 1.01 ? FREE1 : { ...s, z: nz };
        });
        return;
      }
      if (e.deltaY > 0) send({ type: 'advance' });
      else if (e.deltaY < 0) send({ type: 'reverse' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [send, sorter, lightbox, st]);

  if (!st || !computed) {
    return <div className="present-wait">等待放映数据…</div>;
  }

  const page: Page | undefined = computed.pages[st.current];
  if (!page) return <div className="present-wait">（无页面）</div>;

  const size = PAGE_SIZE[st.deck.config.aspect];
  const pxW = (size.w * 96) / 25.4;
  const pxH = (size.h * 96) / 25.4;
  const base = Math.min(vp.w / pxW, vp.h / pxH);
  const shownW = pxW * base;
  const shownH = pxH * base;
  const pageLeft = (vp.w - shownW) / 2;
  const pageTop = (vp.h - shownH) / 2;

  // 变换：自由缩放中心 ox/oy + 拖拽平移 pan；透镜模式不缩放
  let tx = 0;
  let ty = 0;
  let z = 1;
  if (zoomState.mode === 'free') {
    z = zoomState.z;
    tx = -zoomState.ox * (z - 1) * shownW + zoomState.panX;
    ty = -zoomState.oy * (z - 1) * shownH + zoomState.panY;
  }

  const lensOn = zoomState.mode === 'lens';
  // 透镜选框：页宽/页高各一半（面积 1/4），跟随鼠标并夹在页面内
  const lensW = shownW / 2;
  const lensH = shownH / 2;
  const lensLeft = Math.max(pageLeft, Math.min(mouse.current.x * vp.w - lensW / 2, pageLeft + shownW - lensW));
  const lensTop = Math.max(pageTop, Math.min(mouse.current.y * vp.h - lensH / 2, pageTop + shownH - lensH));
  lensGeometry.current = { left: pageLeft, top: pageTop, width: shownW, height: shownH };
  // 拖拽直写上下文（渲染期刷新）：mouseup 提交终值后与本帧 transform 一致
  dragCtx.current = { z, ox: zoomState.mode === 'free' ? zoomState.ox : 0.5, oy: zoomState.mode === 'free' ? zoomState.oy : 0.5, shownW, shownH };

  // 全页浏览布局：缩略图尽量大、填满视窗（行列随页数与视窗自适应）
  let sorterCols = 1;
  let sorterThumbW = 160;
  if (sorter) {
    const N = computed.pages.length;
    // 与 .sorter-overlay 的 padding（36px 5vw）口径一致：内容盒宽 = 90% 视口宽，
    // 否则轨道算得比容器宽，justify-content 居中时两侧等量溢出、看起来左偏
    const maxW = vp.w * 0.9;
    const maxH = vp.h * 0.86;
    let best: { cols: number; w: number } | null = null;
    for (let cols = 1; cols <= Math.min(N, 10); cols++) {
      const rows = Math.ceil(N / cols);
      const w = (maxW - (cols - 1) * 16) / cols;
      const h = (w * size.h) / size.w + 26;
      if (h * rows + (rows - 1) * 16 <= maxH && (!best || w > best.w)) best = { cols, w };
    }
    if (!best) {
      // 页数多到放不下：取列数上限，允许纵向滚动
      const cols = Math.min(N, 10);
      best = { cols, w: (maxW - (cols - 1) * 16) / cols };
    }
    sorterCols = best.cols;
    sorterThumbW = Math.floor(best.w);
  }

  const stageClick = (e: React.MouseEvent) => {
    if (lightbox || blank || sorter) return;
    const t = e.target as HTMLElement;
    if (t.closest('.fig-zoom-btn')) return; // 图片放大按钮自理
    // 透镜模式：点击放大选框区域
    if (lensOn) {
      const left = Math.max(0, Math.min(mouse.current.x * vp.w - pageLeft - lensW / 2, shownW - lensW));
      const top = Math.max(0, Math.min(mouse.current.y * vp.h - pageTop - lensH / 2, shownH - lensH));
      const cx = (left + lensW / 2) / shownW;
      const cy = (top + lensH / 2) / shownH;
      setZoomState({
        mode: 'free', z: LENS_ZOOM,
        ox: Math.max(0, Math.min(1, cx)), oy: Math.max(0, Math.min(1, cy)),
        panX: 0, panY: 0,
      });
      return;
    }
    // 拖拽平移后抑制紧随的 click（防误翻页）；放大态单击不复位（Esc/0/按钮退出）
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (zoomState.mode === 'free' && zoomState.z > 1) return;
    if (t.closest('video, .ref-chip, .xref, .toc-item, .pctrl, button, a')) return;
    send({ type: 'advance' });
  };

  return (
    <div
      className="present-root"
      ref={rootRef}
      onClick={stageClick}
    >
      <div className="present-page-host" style={{ width: shownW, height: shownH }}>
        <div
          ref={presentPageRef}
          className={'present-page' + (dragging ? ' dragging' : '')}
          style={{ width: shownW * z, height: shownH * z, transform: `translate(${tx}px, ${ty}px)` }}
        >
          <div className="present-page-content" style={{ width: pxW, height: pxH, zoom: base }}>
            <ReadySlideStage
              key={stateOwner}
              active={sessionActive && !awaitingState}
              displayZoom={z}
              backgroundActive={!bootReady || zoomState.mode === 'free' && z === 1}
              retainOutgoing={bootReady}
              preparationKey={requestedPreparationKey}
              preloadPages={computed.pages}
              onPreparation={setStagePreparation}
              page={page}
              deck={st.deck}
              computed={computed}
              folder={st.folder ?? ''}
              mode="present"
              revealed={revealed}
              onRef={onRef}
              onSlideJump={onSlideJump}
              highlightLabel={st.flashLabel}
              onZoom={lightbox ? undefined : onZoom}
            />
          </div>
        </div>
        {lensOn && (
          <div ref={lensRef} className="lens-rect" style={{ left: 0, top: 0, width: lensW, height: lensH, transform: `translate(${lensLeft - pageLeft}px, ${lensTop - pageTop}px)` }}>
            <span className="lens-hint">点击放大此区域 · Esc 取消</span>
          </div>
        )}
      </div>

      {sessionActive && (awaitingState || !bootReady) && <div className="resource-progress projection-preparing" data-blocking="true" role="status">
        <span>正在准备放映 {screen.completed + stagePreparation.completed}/{screen.total + stagePreparation.total}</span>
        <progress value={screen.completed + stagePreparation.completed} max={Math.max(1, screen.total + stagePreparation.total)} />
      </div>}

      {laser && (
        <div ref={laserDot} className="laser-dot" style={{ background: LASER_COLORS[laserColorIdx], color: LASER_COLORS[laserColorIdx] }} />
      )}
      {blank && <div className={'present-blank ' + blank} />}

      {sorter && (
        <div className="sorter-overlay" onClick={() => setSorter(false)}>
          <div
            className="sorter-grid"
            style={{ gridTemplateColumns: `repeat(${sorterCols}, ${sorterThumbW}px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            {computed.pages.map((p, i) => (
              <div
                key={i}
                className={'sorter-cell' + (i === st.current ? ' cur' : '')}
                onClick={() => { send({ type: 'goto', index: i }); setSorter(false); }}
              >
                <div className="sorter-thumb" style={{ height: sorterThumbW * (size.h / size.w) }}>
                  <div style={{ width: pxW, height: pxH, transform: `scale(${sorterThumbW / pxW})`, transformOrigin: 'top left' }}>
                    <SlideView page={p} deck={st.deck} computed={computed} folder={st.folder ?? ''} mode="thumb" />
                  </div>
                </div>
                <div className="sorter-no">{i + 1}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className={'pctrl' + (ctrlHover ? ' hover' : '')}
        style={{ left: `calc(50% - ${shownW / 2}px + 14px)`, bottom: `calc(50% - ${shownH / 2}px + 12px)` }}
        onMouseEnter={() => setCtrlHover(true)}
        onMouseLeave={() => setCtrlHover(false)}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <button title="上一页（←）" onClick={() => send({ type: 'reverse' })}><PIcon>{I.prev}</PIcon></button>
        <button title="下一页（→/空格）" onClick={() => send({ type: 'advance' })}><PIcon>{I.next}</PIcon></button>
        <span className="pctrl-sep" />
        <button title="选区放大（Z）：透镜选框，点击放大" className={lensOn ? 'on' : ''}
          onClick={() => setZoomState((s) => (s.mode === 'lens' ? FREE1 : { mode: 'lens' }))}><PIcon>{I.lens}</PIcon></button>
        <button title="缩小（-）" onClick={() => setZoomState((s) => (s.mode === 'free' ? (s.z <= 1.05 ? FREE1 : { ...s, z: Math.max(1, s.z / 1.25) }) : s))}><PIcon>{I.zoomOut}</PIcon></button>
        <button title="放大（+）" onClick={() => setZoomState((s) => (s.mode === 'free' ? { ...s, z: Math.min(8, s.z * 1.25) } : s))}><PIcon>{I.zoomIn}</PIcon></button>
        <button title="复位缩放（0）" onClick={resetZoom}><PIcon>{I.reset}</PIcon></button>
        <span className="pctrl-sep" />
        <button title="全部页面（G）：缩略图跳转" className={sorter ? 'on' : ''} onClick={() => setSorter((v) => !v)}><PIcon>{I.grid}</PIcon></button>
        <span className="pctrl-sep" />
        <button title="激光笔（L）" className={laser ? 'on' : ''} onClick={() => setLaser((v) => !v)}><PIcon>{I.laser}</PIcon></button>
        <button title="激光笔颜色（C）" onClick={() => setLaserColorIdx((i) => (i + 1) % LASER_COLORS.length)}>
          <span className="pctrl-color" style={{ background: LASER_COLORS[laserColorIdx] }} />
        </button>
        <button title="黑屏（B）/ 白屏（W）" className={blank ? 'on' : ''} onClick={() => setBlank((v) => (v ? null : 'black'))}><PIcon>{I.blank}</PIcon></button>
        <span className="pctrl-sep" />
        <button
          title={recording ? '停止录制（自动保存到工程目录）' : '录制放映（60Hz · 系统声+麦克风 · 保存到工程目录）'}
          className={recording ? 'rec on' : 'rec'}
          onClick={() => { if (recording) stopRecording(); else void startRecording(); }}
        >
          {recording
            ? <span className="pctrl-rec-live"><span className="pctrl-rec-dot" />REC</span>
            : <PIcon>{I.record}</PIcon>}
        </button>
        <span className="pctrl-sep" />
        <button
          title="交换放映/监看屏幕（多屏互换放映屏与监看屏）"
          onClick={() => { void window.api.swapPresentScreens(); }}
        ><PIcon>{I.swap}</PIcon></button>
        <span className="pctrl-sep" />
        <button title="结束放映（Esc）" className="danger" onClick={() => send({ type: 'end' })}><PIcon>{I.close}</PIcon></button>
      </div>

      {recording && (
        <div className="pctrl-rec-badge" title="录制中：屏幕 + 系统声音 + 麦克风">
          <span className="pctrl-rec-dot" />
          <span>REC</span>
        </div>
      )}
      {recErr && !recording && (
        <div className="pctrl-rec-err" onClick={() => setRecErr(null)}>{recErr}（点击关闭）</div>
      )}

      {lightbox && (
        <LightboxInner
          lb={lightbox}
          onClose={() => setLightbox(null)}
          captionCtx={computed && st ? { computed, lang: st.deck.config.language, palette: st.deck.config.palette } : undefined}
        />
      )}
    </div>
  );
}
