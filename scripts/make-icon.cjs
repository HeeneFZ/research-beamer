// 一次性工具：把 test_figs/logo.svg 渲染为透明背景 icon.png（512x512）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 512, height: 512,
    transparent: true, frame: false, backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  try {
    const svg = fs.readFileSync(path.join(__dirname, '..', 'test_figs', 'logo.svg'), 'utf8');
    const html = `<body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 800));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), img.toPNG());
    console.log('ICON_OK');
  } catch (e) {
    console.log('ICON_FAIL ' + e);
  } finally {
    app.quit();
  }
});
