// GIF 静帧验证：thumb 模式 GIF 渲染为 canvas（不播放）；edit 画布保持 <img> 播放
(async () => {
  const st = window.__store;
  if (!st) return { error: 'no __store' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = await window.api.readFile('E:/work/课题/科大课题组/2608/thoery_show/deck.md');
  if (r.error || !r.data) return { error: 'read deck: ' + r.error };
  st.getState().loadProjectData({ md: new TextDecoder().decode(r.data), folder: 'E:/work/课题/科大课题组/2608/thoery_show' });
  await sleep(3000);
  const out = {};
  // 胶片缩略图里的 GIF：应为 canvas.gif-still
  const thumbs = [...document.querySelectorAll('.filmstrip .sv.mode-thumb')];
  const thumbCanvases = [...document.querySelectorAll('.filmstrip canvas.gif-still')];
  const thumbGifImgs = [...document.querySelectorAll('.filmstrip .fig img')].filter((im) => im.src.includes('.gif'));
  out.thumbCount = thumbs.length;
  out.stillCanvasCount = thumbCanvases.length;
  out.stillCanvasDrawn = thumbCanvases.map((c) => ({ w: c.width, h: c.height }));
  out.thumbGifImgCount = thumbGifImgs.length; // 期望 0：thumb 模式 GIF 不再用 <img>
  // 画布页（当前页）的 GIF：进 GIF 页应仍是 <img>
  const idx = st.getState().computed.pages.findIndex((p) => (p.slide?.blocks || []).some((b) => b.type === 'figure' && b.src?.endsWith('.gif')));
  st.getState().gotoPage(idx);
  await sleep(1200);
  const canvasGifs = [...document.querySelectorAll('.sv.mode-edit .fig img')].filter((im) => im.src.includes('.gif'));
  out.editGifImgs = canvasGifs.length;
  out.editGifPlaying = canvasGifs.map((im) => im.complete && im.naturalWidth > 0);
  out.pass = out.stillCanvasCount >= 2
    && out.thumbGifImgCount === 0
    && out.stillCanvasDrawn.every((c) => c.w > 0)
    && out.editGifImgs >= 1
    && out.editGifPlaying.every(Boolean);
  return out;
})()
