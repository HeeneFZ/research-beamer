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
  let lastLayoutJson = '';
  useStore.subscribe((s) => {
    if (s.zoom !== lastZoom) { lastZoom = s.zoom; realignKatexRules(); }
    // 排版扫描提交（间距/字号/图高阶梯）会移动既有规则线（无 DOM 子树变更，
    // 观察器不触发）——增量 restyle 跳过已 styled 元素，dy/带宽会陈旧到下次缩放。
    // pageLayout 引用每页变，按内容序列化值比较防无关 set 触发
    const lj = JSON.stringify(s.pageLayout);
    if (lj !== lastLayoutJson) { lastLayoutJson = lj; realignKatexRules(); }
  });
});

const root = createRoot(document.getElementById('root')!);
if (window.location.hash.replace(/^#/, '') === 'present') {
  root.render(<Present />);
} else {
  root.render(<App />);
}
