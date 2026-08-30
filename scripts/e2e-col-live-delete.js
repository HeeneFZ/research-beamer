// 栏占位段 live 行为验证（deleteBlock / insertColEnd 路径）：
// ① 单侧删空 → 栏区保留 + 空侧补占位段（可点击落块，无需保存重开）
// ② 两侧删空 → 栏区整体收回（README「删光双栏区内全部内容自动收回」合约）
// ③ 新栏区两侧皆占位 → 右占位后插块 → 该块上收栏：栏区整体拆除
// ④ 双栏区（前栏区无显式 colend）拆第二栏区 → 前栏区不得吞掉被拆内容
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  st.getState().newProject();
  await sleep(1200);
  const s0 = st.getState();
  const idx = s0.computed.pages.findIndex((p) => p.kind === 'slide' && p.slide?.layout === 'content' && (p.slide?.blocks || []).length === 0);
  st.getState().gotoPage(idx);
  await sleep(500);
  const page = st.getState().computed.pages[st.getState().current];
  const sid = page.slide.id;
  const slideOfState = () => {
    const it = st.getState().deck.items.find((x) => x.kind === 'slide' && x.slide.id === sid);
    return it && it.kind === 'slide' ? it.slide : null;
  };
  const types = () => { const s = slideOfState(); return s ? s.blocks.map((b) => b.type) : null; };
  const texts = () => { const s = slideOfState(); return s ? s.blocks.map((b) => (b.text ?? '')) : null; };

  // 基础栏区：左「左文」右「右文」
  const lId = st.getState().insertColRegion(sid, null);
  await sleep(200);
  const rId = slideOfState().blocks.filter((b) => b.type === 'paragraph')[1].id;
  st.getState().updateBlock(sid, lId, { text: '左文' });
  st.getState().updateBlock(sid, rId, { text: '右文' });
  await sleep(300);
  out.seeded = types();
  // ① 删左文：栏区保留 + 左侧空占位补回
  st.getState().deleteBlock(sid, lId);
  await sleep(300);
  out.afterDeleteLeft = types();
  const t1 = out.afterDeleteLeft || [];
  const sw1 = t1.indexOf('colmark', t1.indexOf('colmark') + 1);
  out.leftReseeded = t1[1] === 'paragraph' && t1[2] === 'colmark' && t1[sw1 - 1] === 'paragraph';
  // ② 删右文：两侧皆空 → 栏区整体收回
  st.getState().deleteBlock(sid, rId);
  await sleep(300);
  out.afterDeleteRight = types();
  out.regionCollapsed = (out.afterDeleteRight || []).every((t) => t !== 'colmark' && t !== 'colend');
  // ③ 新栏区（两侧皆占位）→ 右占位后插「新块」→ 在新块上收栏 → 整体拆除
  st.getState().insertColRegion(sid, null);
  await sleep(200);
  let paras = slideOfState().blocks.filter((b) => b.type === 'paragraph');
  const rightPh3 = paras[paras.length - 1];
  st.getState().insertBlock(sid, rightPh3.id, 'paragraph', { text: '新块' });
  await sleep(200);
  const s3 = slideOfState();
  const tail3 = s3.blocks[s3.blocks.length - 1];
  st.getState().insertColEnd(sid, tail3.id);
  await sleep(300);
  out.afterColEndBlank = types();
  out.blankRegionCollapsed = (out.afterColEndBlank || []).every((t) => t !== 'colmark' && t !== 'colend')
    && (texts() || []).includes('新块');
  // ④ 双栏区：栏区A（左右有字）+ 连续开栏的栏区B（A 无显式 colend）→ 拆 B
  //    期望：A 完好 + 补偿 colend 收住 A，B 的占位逃回单栏（不被 A 右栏吞并）
  const lA = st.getState().insertColRegion(sid, null);
  await sleep(200);
  const sA = slideOfState();
  const rA = sA.blocks[sA.blocks.length - 1]; // A 是页尾唯一栏区：种下顺序 M,lA,M,rA
  st.getState().updateBlock(sid, lA, { text: 'A左' });
  st.getState().updateBlock(sid, rA.id, { text: 'A右' });
  await sleep(200);
  st.getState().insertColRegion(sid, null); // B：追加页尾，其开栏标记隐式收着 A
  await sleep(200);
  const sB = slideOfState();
  const bRight = sB.blocks[sB.blocks.length - 1]; // B 的右占位（种下顺序 M,bL,M,bR）
  st.getState().insertColEnd(sid, bRight.id); // 点 B 右栏唯一块 → 整体拆除 + 补 colend
  await sleep(300);
  out.afterTwoRegionTeardown = types();
  out.twoRegionTexts = texts();
  const mk = (out.afterTwoRegionTeardown || []).filter((t) => t === 'colmark').length;
  const ce = (out.afterTwoRegionTeardown || []).filter((t) => t === 'colend').length;
  // A 完好（2 colmark）+ 恰好 1 个补偿 colend 收住 A + A左/A右 仍在栏内 + B 占位逃出栏外
  const t4t = out.afterTwoRegionTeardown || [];
  const t4x = out.twoRegionTexts || [];
  const aSw = t4t.indexOf('colmark', t4t.indexOf('colmark') + 1);
  out.noMarkerAbsorption = mk === 2 && ce === 1
    && t4t[aSw - 1] === 'paragraph' && t4x[aSw - 1] === 'A左'
    && t4t[aSw + 1] === 'paragraph' && t4x[aSw + 1] === 'A右'
    && t4t[t4t.length - 1] === 'paragraph' && t4t[t4t.length - 2] === 'paragraph';
  out.pass = out.leftReseeded && out.regionCollapsed && out.blankRegionCollapsed && out.noMarkerAbsorption;
  return out;
})()
