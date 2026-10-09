// 工具栏：工程级配置（比例/语言/字体/编号/配色/节分隔页）+ 页码指示

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { PRESETS, PRESET_NAMES } from '../model/palette';

/** 全局标准字号输入：本地文本态，blur/Enter 才钳制提交。
 *  受控+onChange 立即提交会把键入中途值（如目标的 "20" 的第一字符 "2"）
 *  钳到 10 并回填，导致永远无法直接键入目标值（实测复现） */
function FontSizeInput() {
  const fontSize = useStore((s) => s.deck.config.fontSize);
  const setConfig = useStore((s) => s.setConfig);
  const [text, setText] = useState(String(fontSize));
  const textRef = useRef(text);
  textRef.current = text;
  const focused = useRef(false);
  const cancelBlur = useRef(false);
  // 外部变更（撤销等）在未聚焦时同步显示值
  useEffect(() => {
    if (!focused.current) setText(String(fontSize));
  }, [fontSize]);
  const commit = () => {
    const n = parseFloat(textRef.current);
    if (Number.isFinite(n)) {
      const v = Math.min(40, Math.max(10, n));
      if (v !== fontSize) setConfig({ fontSize: v });
      else setText(String(fontSize));
    } else setText(String(fontSize));
  };
  return (
    <input
      type="number" min={10} max={40} step={0.5} value={text}
      title="全局标准正文字号（PPT 等效 pt；每页可在胶片右键 60%–150% 微调）"
      onFocus={() => { focused.current = true; cancelBlur.current = false; }}
      onChange={(e) => { textRef.current = e.target.value; setText(e.target.value); }}
      onBlur={() => { focused.current = false; if (!cancelBlur.current) commit(); cancelBlur.current = false; }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') { cancelBlur.current = true; setText(String(fontSize)); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

export function Toolbar() {
  const deck = useStore((s) => s.deck);
  const computed = useStore((s) => s.computed);
  const current = useStore((s) => s.current);
  const setConfig = useStore((s) => s.setConfig);
  const c = deck.config;

  return (
    <div className="toolbar">
      <span className="tb-page-ind">
        {computed.pages[current]?.kind === 'divider' ? '§ ' : ''}{computed.pages[current]?.no ?? 0} / {computed.pages.length}
      </span>
      <span className="tb-sep" />
      <label>
        比例
        <select value={c.aspect} onChange={(e) => setConfig({ aspect: e.target.value as typeof c.aspect })}>
          <option value="16:9">16:9</option>
          <option value="4:3">4:3</option>
        </select>
      </label>
      <label>
        语言
        <select value={c.language} onChange={(e) => setConfig({ language: e.target.value as typeof c.language })}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        字号
        <FontSizeInput />
      </label>
      <label>
        西文字体
        <select value={c.fontEn} onChange={(e) => setConfig({ fontEn: e.target.value as typeof c.fontEn })}>
          <option value="serif">衬线</option>
          <option value="sans">无衬线</option>
        </select>
      </label>
      <label>
        中文字体
        <select value={c.fontZh} onChange={(e) => setConfig({ fontZh: e.target.value as typeof c.fontZh })}>
          <option value="serif">思源宋体 / Noto 宋体</option>
          <option value="sans">思源黑体 / Noto 黑体</option>
        </select>
      </label>
      <label>
        编号
        <select value={c.numbering} onChange={(e) => setConfig({ numbering: e.target.value as typeof c.numbering })}>
          <option value="continuous">连续 (1)</option>
          <option value="perSection">按节 (1.1)</option>
        </select>
      </label>
      <label>
        配色
        <select
          value={c.palette.preset ?? ''}
          onChange={(e) => {
            const name = e.target.value;
            if (name && PRESETS[name]) {
              // 必须带上 preset 字段：展开 PRESETS 只有颜色值，丢失 preset 会让
              // select 的 value 变 ''、视觉回落到首项，导致再选回首项不触发 onChange（无法切回）
              setConfig({ palette: { ...PRESETS[name], preset: name } });
            }
          }}
        >
          {PRESET_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="tb-check">
        <input
          type="checkbox"
          checked={c.sectionPages}
          onChange={(e) => setConfig({ sectionPages: e.target.checked })}
        />
        节分隔页
      </label>
      <span className="tb-spacer" />
    </div>
  );
}
