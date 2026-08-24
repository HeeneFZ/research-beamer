// E2E 验证（第四十轮）：引用标签链路修复
// 场景 = 用户报障的完整路径：annoeq 加 label → 段落里 @ 选择器引用 → 退出编辑 →
// 展示态必须渲染成芯片（不得露 [@eq:eq:x] 源码）且编号可解析（不得 eq(?)）；
// 另覆盖历史脏数据自愈：md 里预置 [@eq:eq:x] 直接正确渲染。
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store hook' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => st.getState();
  const out = {};

  await sleep(2600);

  // 找「公式注释与引用」页（index 4，含 annoeq）
  const pages = state().computed.pages;
  let idx = -1;
  for (let i = 0; i < pages.length; i++) {
    const sl = pages[i].slide;
    if (sl && sl.blocks.some((b) => b.type === 'annoeq')) { idx = i; break; }
  }
  if (idx < 0) return { error: 'no annoeq page' };
  state().gotoPage(idx);
  await sleep(1500);

  const slide = state().computed.pages[idx].slide;
  const slideOf = () => {
    const d = state().deck;
    const it = d.items.find((x) => x.kind === 'slide' && x.slide.id === slide.id);
    return it.kind === 'slide' ? it.slide : null;
  };
  const annoeq = slideOf().blocks.find((b) => b.type === 'annoeq');

  // ---- 1) 面板给 annoeq 设裸 label（归一 choke point）----
  state().updateBlock(slide.id, annoeq.id, { label: 'pos' });
  await sleep(600);
  out.labelNormalize = {
    stored: slideOf().blocks.find((b) => b.id === annoeq.id)?.label,
    pass: slideOf().blocks.find((b) => b.id === annoeq.id)?.label === 'eq:pos',
  };

  // ---- 2) 新段落：@ picker 引用该 annoeq（真实 UI 路径）----
  const lastPara = [...slideOf().blocks].reverse().find((b) => b.type === 'paragraph');
  const pId = state().insertBlock(slide.id, lastPara.id, 'paragraph', { text: '' });
  await sleep(500);
  // 新块需先进编辑态（点击块体 → FlowBlock setEditing），TipTap 才挂载
  const pEl0 = document.querySelector('.editor-canvas [data-bid="' + pId + '"]');
  pEl0?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(900);
  const pm = document.querySelector('.editor-canvas [data-bid="' + pId + '"] .ProseMirror');
  out.pmFound = !!pm;
  if (pm) {
    // 键入 @ 弹出选择器
    pm.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true }));
    document.execCommand('insertText', false, '@');
    await sleep(700);
    const picker = document.querySelector('.ref-picker');
    out.pickerShown = !!picker;
    const items = picker ? [...picker.querySelectorAll('.ref-picker-item')] : [];
    const cand = items.find((el) => el.textContent.includes('eq:pos'));
    out.candFound = !!cand;
    if (cand) {
      cand.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await sleep(800);
      // 编辑态芯片：应显示编号而非 eq(?)
      const chip = document.querySelector('.editor-canvas [data-bid="' + pId + '"] .chip-node');
      out.chipInEditor = {
        exists: !!chip,
        text: chip?.textContent,
        missing: !!chip?.querySelector('.xref-missing'),
      };
      // 退出编辑（点画布空白）
      const canvas = document.querySelector('.editor-canvas');
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }));
      await sleep(900);
      // 展示态：不得露 [@ 源码；应渲染 .ref-chip / .xref
      const paraEl = document.querySelector('.editor-canvas [data-bid="' + pId + '"]');
      out.afterExit = {
        rawSourceLeak: paraEl ? paraEl.textContent.includes('[@') : null,
        hasXref: !!paraEl?.querySelector('.xref'),
        xrefText: paraEl?.querySelector('.xref')?.textContent,
        pass: !!paraEl && !paraEl.textContent.includes('[@') && !!paraEl.querySelector('.xref') && !paraEl.querySelector('.xref-missing'),
      };
      // 落盘 md 也不含双重前缀
      const { serializeMarkdown } = window.__serialize ? window.__serialize : {};
      out.mdClean = {
        doublePrefix: state().deck ? JSON.stringify(state().deck).includes('eq:eq:pos') : null,
      };
    }
  }

  // ---- 3) 历史脏数据自愈：直接把块文本改成 [@eq:eq:pos] 再看展示态 ----
  const t1 = slideOf().blocks.find((b) => b.id === pId);
  if (t1) {
    state().updateBlock(slide.id, pId, { text: '旧文档自愈：[@eq:eq:pos] 与 [@eq:pos]' });
    state().setEditing(null);
    await sleep(900);
    const paraEl = document.querySelector('.editor-canvas [data-bid="' + pId + '"]');
    out.dirtyHeal = {
      rawSourceLeak: paraEl ? paraEl.textContent.includes('[@') : null,
      xrefCount: paraEl ? paraEl.querySelectorAll('.xref').length : 0,
      pass: !!paraEl && !paraEl.textContent.includes('[@') && paraEl.querySelectorAll('.xref').length === 2,
    };
  }

  return out;
})()
