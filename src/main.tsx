import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Present from './Present';
import 'katex/dist/katex.min.css';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
if (window.location.hash.replace(/^#/, '') === 'present') {
  root.render(<Present />);
} else {
  root.render(<App />);
}
