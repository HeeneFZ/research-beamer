import { createRoot } from 'react-dom/client';
import App from './App';
import Present from './Present';
import { installKatexRuleSnap, realignKatexRules } from './components/katexRuleSnap';
import { useStore } from './state/store';
import 'katex/dist/katex.min.css';
import './styles.css';

// KaTeX 分数线/上下划线设备像素网格对齐（详见 katexRuleSnap.ts 模块注释）
installKatexRuleSnap(() => {
  let lastZoom = -1;
  let lastLayout = useStore.getState().pageLayout;
  useStore.subscribe((s) => {
    if (s.zoom !== lastZoom) { lastZoom = s.zoom; realignKatexRules(); }
    // 排版扫描提交（间距/字号/图高阶梯）会移动既有规则线（无 DOM 子树变更，
    // 观察器不触发）——增量 restyle 跳过已 styled 元素，dy/带宽会陈旧到下次缩放。
    // setPageLayout 在值未改变时保留引用，无需每次击键序列化全量缓存。
    if (s.pageLayout !== lastLayout) { lastLayout = s.pageLayout; realignKatexRules(); }
  });
});

// Load the small bundled math faces once, avoiding fallback metrics when editing
// introduces a new symbol. The visible page is never laid out with a temporary font.
const mathFonts = [...document.fonts].filter((face) => face.family.includes('KaTeX_'));
void Promise.all(mathFonts.map((face) => face.load().catch(() => null))).then(() => {
  const root = createRoot(document.getElementById('root')!);
  root.render(window.location.hash.replace(/^#/, '') === 'present' ? <Present /> : <App />);
});
