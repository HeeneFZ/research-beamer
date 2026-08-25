// 页面排版引擎（静默探测 + 原子提交，有界）——排版基准 = layoutSpec 固定字阶：
//   从标称态（宽松间距 + 图高顶天 + 字号不压）出发，在测量容器上临时覆写 CSS 变量、
//   强制同步 reflow 读溢出——全程不经 store、不触发绘制，中间态不可见；
//   算出「放得下的最宽松状态」后一次性提交 store.pageLayout（唯一一次可见变化）。
//   压缩阶梯（用户合约·第廿九轮起，图优先于字）：① 间距（行距/段距，s 0→1）
//   → ② 字号（fit 步进 −0.05，下限 spec.fitMin）→ ③ 图高（天花板 55cqh 起 ×0.85 递减至下限，
//   溢出则容忍并 toast 建议删减）。每阶段粗步落定后连续二分细化（compressBest）：
//   取「放得下的最宽松参数」，消除粗步+换行悬崖的过冲（压得厉害却离页脚很远）。
//   宽度权威：图按宽度需求占位、挤压链先压文字体系，
//   图只在字距到底仍放不下时让步；不再做任何文本量估算预压（估错即冤案且棘轮单向回不来）。
//   结果对内容+比例+字号配置确定（无状态机/无回滚/不写 md）：
//   进页重扫得到同一终态 → setPageLayout 相同值不提交 → 零视觉变化、零振荡。
//   胶片缩略图（mode=thumb，与画布同 mm 尺寸排版）承担后台预算：
//   打开工程即把全部页算完，进页即是终态。
// 触发域：挂载 / 块增删或文本量变化（sig，含 fontSize/fontScale）/ 比例切换（aspect）。

import { RefObject, useEffect } from 'react';
import { useStore } from '../../state/store';
import {
  computeLayoutSpec, compressBest, layoutCssVars, FIT_TOL, LayoutSpec, SpacingState,
} from '../../model/layoutSpec';
import { Aspect } from '../../model/types';

/** 探测覆写的变量子集（字号体系 --fs-* 固定不参与探测；间距单通道 --gap-para） */
const PROBE_VARS = ['--lh', '--gap-para', '--gap-item', '--img-max-h', '--body-fit'];

export function useLayoutScan(
  ref: RefObject<HTMLElement | null>,
  slideId: string | undefined,
  enabled: boolean,
  aspect: Aspect,
  sig: string,
): void {
  useEffect(() => {
    if (!enabled || !slideId) return;
    const el = ref.current;
    if (!el) return;
    const key = `${slideId}|${aspect}`;

    let timer = 0;
    let waits = 0;   // 常规异步等待（img/canvas/KaTeX）有界 60×250ms
    let rounds = 0;  // 复核外轮有界（防晚到资源引起的漂移）

    const getSpec = (): LayoutSpec => {
      const st = useStore.getState();
      const sl = st.deck.items.find((x) => x.kind === 'slide' && x.slide.id === slideId);
      return computeLayoutSpec(
        {
          blocks: sl && sl.kind === 'slide' ? sl.slide.blocks : [],
          fontScale: sl && sl.kind === 'slide' ? sl.slide.fontScale : undefined,
          fontSize: st.deck.config.fontSize,
        },
      );
    };

    /** 静默探测：候选状态覆写到测量容器（inline 优先于 .sv 根继承值），同步 reflow 读溢出后还原 */
    const probeOver = (st: SpacingState, spec: LayoutSpec): number => {
      const vars = layoutCssVars(spec, st);
      for (const k of PROBE_VARS) el.style.setProperty(k, vars[k]);
      const over = el.scrollHeight - el.clientHeight;
      for (const k of PROBE_VARS) el.style.removeProperty(k);
      return over;
    };

    /** 一次成型计算：压缩阶梯粗步 + 连续细化（layoutSpec.compressBest 纯函数），
     *  返回放得下的最宽松状态（都不放得下则取全程溢出最小者） */
    const computeBest = (): { st: SpacingState; over: number } => {
      const spec = getSpec();
      return compressBest(spec, (st) => probeOver(st, spec));
    };

    const tick = () => {
      // EPS 经主进程 Ghostscript 异步转换：转换完成前块很矮，必须等到底（十几秒级）。
      // 不计 waits 慢轮询——否则拿占位高度提前定稿，转换完成版面长高无人复扫（假收敛溢出）
      if (el.querySelector('[data-eps-pending]') != null) {
        timer = window.setTimeout(tick, 400);
        return;
      }
      const imgs = [...el.querySelectorAll('img')];
      const canvases = [...el.querySelectorAll('canvas')];
      const imgsPending = imgs.some((i) => !(i.complete && i.naturalWidth > 0));
      // 画布（pdf/eps 矢量）异步渲染：宽度未就绪视为未稳定
      const cvsPending = canvases.some((c) => c.width === 0);
      // KaTeX 异步渲染：.eq-disp 未出 .katex 前测高会假溢出（raw latex 文本更长）
      const katexPending = [...el.querySelectorAll('.eq-disp')].some((d) => !d.querySelector('.katex'));
      if ((imgsPending || cvsPending || katexPending) && waits++ < 60) {
        timer = window.setTimeout(tick, 250);
        return;
      }

      const prev = useStore.getState().pageLayout[key];
      const { st, over } = computeBest();
      const changed = !prev || prev.s !== st.s || prev.imgH !== st.imgH || prev.fit !== st.fit;
      useStore.getState().setPageLayout(key, st);
      if (over > FIT_TOL && changed) {
        useStore.getState().setFlashMsg('内容超出页面（字号已到排版下限），建议删减或分页');
      }
      // 复核轮（晚到资源/字体可能漂移）；结果稳定即收工（相同值提交为 no-op）
      if (rounds++ < 4) timer = window.setTimeout(tick, 400);
    };
    timer = window.setTimeout(tick, 300);
    return () => clearTimeout(timer);
  }, [ref, slideId, enabled, aspect, sig]);
}
