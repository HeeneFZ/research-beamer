// 封面/结尾页 Logo（校徽/自定义图案）——两种形态：
// 1. 锚定态（未设置 logoPos，默认）：渲染在色块卡片内右下角（.logo-in-card，
//    卡片相对定位 right 4cqw / bottom 5.3cqh / 高 8cqw、宽上限 24cqw）——
//    卡片高度随内容变化时 Logo 恒贴卡片右下，不受页百分比写死值影响
// 2. 浮动态（logoPos 已设置，拖拽/调宽后持久化）：页面级自由定位（x/y/w 页百分比）
// 编辑态：拖动移动、左右缘手柄调宽（复用图块 .edge-rz 视觉）、悬停「更换/复位/删除」；
// 锚定态首次拖/拉即以当前实描位置换算页百分比转入浮动态。
// 载入/更换复用 pickMedia + importMedia 管线；非编辑态纯展示不拦截点击。

import { useRef, useState } from 'react';
import { DeckConfig, Pos } from '../../model/types';
import { fileUrl } from '../pdfRaster';
import { absMediaPath } from '../paths';
import { useStore } from '../../state/store';
import { SlideMode } from './types';

const MIN_W = 3;
const MAX_W = 90;

const r1 = (v: number): number => Math.round(v * 10) / 10;
const clampW = (w: number): number => r1(Math.min(MAX_W, Math.max(MIN_W, w)));
/** x/w 联合钳制：w 合法范围内 x ∈ [0, 100−w] */
const clampX = (p: Pos): Pos => ({ ...p, x: r1(Math.min(100 - p.w, Math.max(0, p.x))) });
/** y 钳制：min 在内层（图高于页时 100−h 为负，先夹 h 再夹 y，防跳负甩出页顶） */
const clampY = (y: number, hPct: number): number => r1(Math.max(0, Math.min(100 - Math.min(100, hPct), Math.max(0, y))));

/** 选图并导入工程 media/：返回相对路径（media/xxx）；取消/失败返回 null */
export async function pickLogoFile(folder: string): Promise<string | null> {
  const revision = useStore.getState().mediaRevision;
  const valid = () => useStore.getState().mediaRevision === revision && useStore.getState().folder === folder;
  const r = await window.api.pickMedia();
  if (!r || !valid()) return null;
  const imp = await window.api.importMedia({ srcPath: r.path, folder });
  return valid() && imp?.fileName ? 'media/' + imp.fileName : null;
}

/** 卡内右下「＋ Logo」占位（编辑态、未设置 logo 时显示；点击载入） */
export function LogoAddChip() {
  const folder = useStore((s) => s.folder);
  const setConfig = useStore((s) => s.setConfig);
  const setFlashMsg = useStore((s) => s.setFlashMsg);
  const add = async () => {
    if (!folder) {
      setFlashMsg('请先保存工程（需要 media/ 目录）');
      return;
    }
    const revision = useStore.getState().mediaRevision;
    const src = await pickLogoFile(folder);
    // 只落 logo 不落 logoPos：默认锚定卡片右下，用户拖/拉后才持久化浮动态坐标
    if (src && useStore.getState().mediaRevision === revision && useStore.getState().folder === folder) setConfig({ logo: src });
  };
  return (
    <button className="logo-add-chip" onClick={() => { void add(); }} title="载入校徽 / 自定义图案" draggable={false}>
      ＋ Logo
    </button>
  );
}

export function CoverLogo({ config, folder, mode }: {
  config: DeckConfig;
  folder: string;
  mode: SlideMode;
}) {
  const setConfig = useStore((s) => s.setConfig);
  const setFlashMsg = useStore((s) => s.setFlashMsg);
  const hostRef = useRef<HTMLDivElement>(null);
  // 拖/拉期间只动本地态（拖完一次 setConfig：一条撤销记录，且不逐帧深拷贝 deck）
  const liveRef = useRef<Pos | null>(null);
  const [live, setLive] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  if (!config.logo) return null;

  const startDrag = (e: React.MouseEvent, kind: 'move' | 'rz-l' | 'rz-r') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const host = hostRef.current;
    const page = host?.closest('.sv') as HTMLElement | null;
    if (!host || !page) return;
    const pr = page.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const pw = pr.width || 1;
    const ph = pr.height || 1;
    // 起点一律取当前实描几何（锚定态 = 卡片右下实际位置）：拖/拉后无跳变
    const p0: Pos = {
      x: ((hr.left - pr.left) / pw) * 100,
      y: ((hr.top - pr.top) / ph) * 100,
      w: (hr.width / pw) * 100,
    };
    const hPct0 = (hr.height / ph) * 100;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setDragging(true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = kind === 'move' ? 'grabbing' : 'ew-resize';
    const onMove = (ev: MouseEvent) => {
      const dxPct = ((ev.clientX - x0) / pw) * 100;
      const dyPct = ((ev.clientY - y0) / ph) * 100;
      let next: Pos;
      if (kind === 'move') {
        next = clampX({ ...p0, x: r1(p0.x + dxPct), y: clampY(p0.y + dyPct, hPct0) });
      } else if (kind === 'rz-r') {
        next = clampX({ ...p0, w: clampW(p0.w + dxPct) });
      } else {
        const w = clampW(p0.w - dxPct);
        next = clampX({ ...p0, w, x: p0.x + (p0.w - w) });
      }
      // 调宽后图高随之变化（等比），按新宽复核 y 不越底边
      if (kind !== 'move' && p0.w > 0) next.y = clampY(next.y, hPct0 * (next.w / p0.w));
      liveRef.current = next;
      setLive(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      setDragging(false);
      // 有实际位移才提交（点击空拖不动位置）；落库仅一条撤销记录
      const cur = liveRef.current;
      liveRef.current = null;
      setLive(null);
      if (cur && (cur.x !== p0.x || cur.y !== p0.y || cur.w !== p0.w)) setConfig({ logoPos: cur });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const replace = async () => {
    if (!folder) {
      setFlashMsg('请先保存工程（需要 media/ 目录）');
      return;
    }
    const revision = useStore.getState().mediaRevision;
    const src = await pickLogoFile(folder);
    if (src && useStore.getState().mediaRevision === revision && useStore.getState().folder === folder) setConfig({ logo: src });
  };

  // 锚定态（无 logoPos）由卡片 CSS 定位；浮动态用页百分比
  const anchored = config.logoPos == null;
  const pos = live ?? config.logoPos ?? { x: 0, y: 0, w: 24 };
  const style = anchored ? undefined : { left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%` };
  return (
    <div
      ref={hostRef}
      className={(anchored ? 'logo-in-card' : 'logo-float')
        + (mode === 'edit' ? ' edit' : '')
        + (anchored ? '' : ' floating')
        + (dragging ? ' dragging' : '')}
      style={style}
      onMouseDown={mode === 'edit' ? (e) => startDrag(e, 'move') : undefined}
      title={mode === 'edit' ? (anchored ? '拖动移出卡片角落；左右缘手柄调宽' : '拖动移动；左右缘手柄调宽') : undefined}
    >
      <img src={fileUrl(absMediaPath(folder, config.logo))} alt="" draggable={false} />
      {mode === 'edit' && (
        <>
          <div className="logo-tools">
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => { void replace(); }}>更换</button>
            {!anchored && (
              <button
                className="reset"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setConfig({ logoPos: undefined })}
                title="回到色块右下角"
              >
                复位
              </button>
            )}
            <button
              className="danger"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setConfig({ logo: undefined, logoPos: undefined })}
            >
              删除
            </button>
          </div>
          <div className="edge-rz edge-rz-l" onMouseDown={(e) => startDrag(e, 'rz-l')} />
          <div className="edge-rz edge-rz-r" onMouseDown={(e) => startDrag(e, 'rz-r')} />
        </>
      )}
    </div>
  );
}
