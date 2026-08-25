import React from 'react';
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
  useStore.subscribe((s) => {
    if (s.zoom !== lastZoom) { lastZoom = s.zoom; realignKatexRules(); }
  });
});

const root = createRoot(document.getElementById('root')!);
if (window.location.hash.replace(/^#/, '') === 'present') {
  root.render(<Present />);
} else {
  root.render(<App />);
}
