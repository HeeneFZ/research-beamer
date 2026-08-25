// Electron main process (plain CJS, no build step needed)
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// E2E 模式用独立 userData：不与用户正开着的实例抢单实例锁，也不碰用户示例副本
if (process.env.E2E_SCREENSHOT || process.env.E2E_PDF || process.env.E2E_EVAL) {
  app.setPath('userData', require('path').join(require('os').tmpdir(), 'beamerapp-e2e'));
}

let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    backgroundColor: '#eef0f3',
    frame: false,
    show: false, // 首帧渲染完成后再显示，配合 splash 提升启动观感
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(indexPath, { hash: process.env.E2E_EXAMPLE ? `example=${process.env.E2E_EXAMPLE}` : '' });
  // 关闭后置空：放映窗存活时主窗先关（window-all-closed 不触发），second-instance
  // 再进 if (mainWindow) 会对已销毁窗口调 isMinimized() 抛 "Object has been destroyed"
  mainWindow.on('closed', () => { mainWindow = null; });
  // 首帧后再显示（配合 show:false 防白屏）；⚠ 此行丢失 = 窗口永不显示（第卅三轮实测事故）
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  let reloaded = false;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('render-process-gone', details?.reason);
    if (!reloaded && details?.reason !== 'clean-exit') {
      reloaded = true;
      setTimeout(() => mainWindow?.reload(), 300);
    }
  });
  mainWindow.webContents.on('unresponsive', () => {
    setTimeout(() => { try { mainWindow?.webContents?.stop(); } catch (_) { /* ignore */ } }, 5000);
  });

  // E2E smoke-test hook: E2E_SCREENSHOT=/abs/out.png E2E_PDF=/abs/out.pdf npx electron .
  if (process.env.E2E_SCREENSHOT || process.env.E2E_PDF || process.env.E2E_EVAL) {
    // 硬性看门狗：渲染进程在 once('did-finish-load') 触发前崩溃/加载失败时，
    // E2E 流程不再执行、finally 的 app.quit() 也不会跑——兜底强退，杜绝僵尸 E2E 实例驻留
    const watchdog = setTimeout(() => {
      console.log('E2E_WATCHDOG timeout, force exit');
      app.exit(1);
    }, Number(process.env.E2E_WATCHDOG_MS || 120000));
    watchdog.unref();
    app.on('quit', () => clearTimeout(watchdog));
    const logs = [];
    mainWindow.webContents.on('console-message', (_e, _l, msg) => {
      logs.push(msg);
      if (process.env.E2E_LIVE) console.log('[renderer]', msg.slice(0, 300));
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => console.log('RENDERER_GONE', JSON.stringify(details)));
    mainWindow.webContents.on('unresponsive', () => console.log('RENDERER_UNRESPONSIVE'));
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          // 序列截图：eval 在渲染进程准备 window.__shotSeq = [{ name, wait?, rect?, run() }]
          //（run 切换界面状态；rect() 返回 {x,y,width,height} 指定区域，缺省整窗）。
          // 依次执行 run → 截图，写 E2E_SHOT_DIR/<tag?><name>.png（放映窗 tag=present）
          const shoot = async (wc, tag) => {
            if (!process.env.E2E_SHOT_DIR) return;
            // __shotSeq 元素含函数（无法结构化克隆跨上下文），只在渲染进程内取 length，
            // run/rect 一律用下标注入的代码串执行
            const n = await wc.executeJavaScript('window.__shotSeq ? window.__shotSeq.length : 0').catch(() => 0);
            if (!n) return;
            fs.mkdirSync(process.env.E2E_SHOT_DIR, { recursive: true });
            for (let i = 0; i < n; i++) {
              try {
                const step = await wc.executeJavaScript(`window.__shotSeq[${i}] ? window.__shotSeq[${i}].name : null`).catch(() => null);
                await wc.executeJavaScript(`(async () => { await window.__shotSeq[${i}].run(); })()`);
                const wait = await wc.executeJavaScript(`window.__shotSeq[${i}].wait || 700`).catch(() => 700);
                await new Promise((r2) => setTimeout(r2, wait));
                const rect = await wc.executeJavaScript(`window.__shotSeq[${i}].rect ? window.__shotSeq[${i}].rect() : null`).catch(() => null);
                const img = rect && Number.isFinite(rect.x) && Number.isFinite(rect.width)
                  ? await wc.capturePage({
                    x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)),
                    width: Math.max(2, Math.round(rect.width)), height: Math.max(2, Math.round(rect.height)),
                  })
                  : await wc.capturePage();
                const safe = String(tag ? tag + '-' + step : step || ('shot' + i)).replace(/[^-\w.]/g, '_');
                fs.writeFileSync(require('path').join(process.env.E2E_SHOT_DIR, safe + '.png'), img.toPNG());
                console.log('E2E_SHOT ' + safe + ' ' + img.getSize().width + 'x' + img.getSize().height);
              } catch (er) {
                console.log('E2E_SHOT_SKIP ' + i + ' ' + er);
              }
            }
          };
          // 回归门：主窗必须可见（show:false 依赖 ready-to-show 调 show()；该行曾被
          // 误删致 exe 双击无窗口——e2e 不依赖可见窗口故全绿。此处强制断言）
          {
            let vis = mainWindow.isVisible();
            const t0 = Date.now();
            while (!vis && !mainWindow.isDestroyed() && Date.now() - t0 < 8000) {
              await new Promise((r2) => setTimeout(r2, 250));
              vis = mainWindow.isVisible();
            }
            console.log('E2E_WIN_VISIBLE=' + vis);
          }
          if (process.env.E2E_EVAL) {
            const r = await mainWindow.webContents.executeJavaScript(process.env.E2E_EVAL);
            if (r !== undefined && r !== null) console.log('E2E_EVAL_RESULT=' + JSON.stringify(r));
            await shoot(mainWindow.webContents, '');
            await new Promise((r2) => setTimeout(r2, 1200));
          }
          // 放映窗评估：主窗 eval 中 startPresent 后，对 presentWin 执行
          if (process.env.E2E_EVAL_PRESENT) {
            if (presentWin && !presentWin.isDestroyed()) {
              const rp = await presentWin.webContents.executeJavaScript(process.env.E2E_EVAL_PRESENT);
              if (rp !== undefined && rp !== null) console.log('E2E_PRESENT_RESULT=' + JSON.stringify(rp));
              await shoot(presentWin.webContents, 'present');
            } else {
              console.log('E2E_PRESENT_RESULT=' + JSON.stringify({ error: 'no present window' }));
            }
            await new Promise((r2) => setTimeout(r2, 600));
          }
          if (process.env.E2E_SCREENSHOT) {
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(process.env.E2E_SCREENSHOT, img.toPNG());
          }
          if (process.env.E2E_PDF) {
            await mainWindow.webContents.executeJavaScript(`document.body.classList.add('print-mode')`);
            await new Promise((r) => setTimeout(r, 300));
            const data = await mainWindow.webContents.printToPDF({
              printBackground: true,
              margins: { marginType: 'none' },
              preferCSSPageSize: true,
            });
            fs.writeFileSync(process.env.E2E_PDF, data);
            console.log('E2E_PDF bytes=' + data.length);
          }
          const errors = logs.filter((m) => /error|failed/i.test(m));
          if (process.env.E2E_VERBOSE) console.log('E2E_LOGS=' + JSON.stringify(logs.slice(0, 40)));
          console.log('E2E_OK console-errors=' + JSON.stringify(errors.slice(0, 10)));
        } catch (e) {
          console.log('E2E_FAIL ' + e);
        } finally {
          app.quit();
        }
      }, Number(process.env.E2E_DELAY_MS || 4000));
    });
  }
}

// 单实例锁：杜绝多实例同时写 userData/GPU cache
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    setupRecordingHandlers();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- helpers ----------

function findGhostscript() {
  const candidates = [];
  const gsRoot = 'C:\\Program Files\\gs';
  try {
    for (const dir of fs.readdirSync(gsRoot)) {
      const p = path.join(gsRoot, dir, 'bin', 'gswin64c.exe');
      if (fs.existsSync(p)) candidates.push(p);
    }
  } catch (_) { /* not installed under Program Files */ }
  candidates.sort().reverse();
  return candidates[0] || null;
}

function readProjectFromFolder(folder) {
  const mdPath = path.join(folder, 'deck.md');
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null;
  return { md, folder };
}

// ---------- IPC ----------

// 解析示例/相对工程路径：开发时在应用目录；打包后在 resources，首次访问复制到 userData（可写，自动保存才能工作）
// 示例内容升级时递增此版本号——userData 下的旧副本整体换新（用户改过示例会被覆盖，示例本就是演示素材）
const EXAMPLE_VERSION = '8';
function resolveProjectFolder(relPath) {
  if (path.isAbsolute(relPath)) return relPath;
  if (!app.isPackaged) return path.join(app.getAppPath(), relPath);
  const srcDir = path.join(process.resourcesPath, relPath);
  const writableDir = path.join(app.getPath('userData'), relPath);
  if (relPath.startsWith('examples')) {
    const verFile = path.join(app.getPath('userData'), 'examples', '.version');
    const curVer = fs.existsSync(verFile) ? fs.readFileSync(verFile, 'utf8') : '';
    if (curVer !== EXAMPLE_VERSION && fs.existsSync(srcDir)) {
      const examplesDir = path.join(app.getPath('userData'), 'examples');
      fs.rmSync(examplesDir, { recursive: true, force: true });
      fs.cpSync(path.join(process.resourcesPath, 'examples'), examplesDir, { recursive: true });
      fs.writeFileSync(verFile, EXAMPLE_VERSION, 'utf8');
    }
  }
  if (!fs.existsSync(writableDir) && fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, writableDir, { recursive: true });
  }
  return fs.existsSync(writableDir) ? writableDir : srcDir;
}

ipcMain.handle('project:loadPath', async (_e, relPath) => {
  try {
    const folder = resolveProjectFolder(relPath);
    if (!fs.existsSync(path.join(folder, 'deck.md'))) return null;
    return readProjectFromFolder(folder);
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '打开 PPT 工程',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const folder = r.filePaths[0];
  try {
    return readProjectFromFolder(folder);
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('project:save', async (_e, { folder, md }) => {
  try {
    if (!folder) {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '选择工程保存文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      folder = r.filePaths[0];
    }
    const mediaDir = path.join(folder, 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(folder, 'deck.md'), md, 'utf8');
    return { folder };
  } catch (e) {
    return { error: String(e) };
  }
});

// 图片/视频导入工程 media/（仅复制文件）
ipcMain.handle('media:import', async (_e, { srcPath, folder }) => {
  try {
    if (!folder) return { error: 'no folder' };
    const mediaDir = path.join(folder, 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    let name = path.basename(srcPath);
    // 重名自动加序号，不覆盖既有文件
    let dest = path.join(mediaDir, name);
    for (let i = 1; fs.existsSync(dest); i++) {
      const ext = path.extname(name);
      dest = path.join(mediaDir, path.basename(name, ext) + '-' + i + ext);
    }
    name = path.basename(dest);
    fs.copyFileSync(srcPath, dest);
    return { fileName: name };
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('media:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片或视频',
    properties: ['openFile'],
    filters: [
      {
        name: '图片 / 视频',
        extensions: ['png', 'jpg', 'jpeg', 'svg', 'pdf', 'eps', 'mp4', 'webm', 'mov', 'gif'],
      },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0] };
});

// EPS → 矢量 PDF（Ghostscript pdfwrite，无损矢量转换）
// 按 absPath 在途去重——多个副本同时触发时避免并发双写输出文件
const epsPdfInflight = new Map(); // absPath -> Promise<{pdf}|{error}>
ipcMain.handle('media:ensureEpsPdf', async (_e, { absPath }) => {
  try {
    const out = absPath.replace(/\.eps$/i, '') + '.pdf';
    if (fs.existsSync(out)) return { pdf: out };
    if (epsPdfInflight.has(absPath)) return epsPdfInflight.get(absPath);
    const gs = findGhostscript();
    if (!gs) return { error: 'Ghostscript not found (C:\\Program Files\\gs)' };
    const job = new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile(
        gs,
        ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=pdfwrite', '-o', out, absPath],
        { timeout: 30000, killSignal: 'SIGKILL' },
        (err) => (err ? resolve({ error: String(err) }) : resolve({ pdf: out })),
      );
    }).finally(() => epsPdfInflight.delete(absPath));
    epsPdfInflight.set(absPath, job);
    return job;
  } catch (e) {
    return { error: String(e) };
  }
});

// 异步读（大 PDF/视频可达几十 MB；readFileSync 会卡主进程消息循环）
ipcMain.handle('file:read', async (_e, absPath) => {
  try {
    const data = await fs.promises.readFile(absPath);
    return { data: new Uint8Array(data) };
  } catch (e) {
    return { error: String(e) };
  }
});

// 导出 PDF：@page CSS 决定物理尺寸（preferCSSPageSize）
ipcMain.handle('export:pdf', async (_e, { suggestedName }) => {
  // E2E 模式：跳过保存对话框，写固定临时路径
  if (process.env.E2E_SCREENSHOT || process.env.E2E_PDF || process.env.E2E_EVAL) {
    return { path: require('path').join(require('os').tmpdir(), 'beamerapp-e2e-export.pdf') };
  }
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PDF',
    defaultPath: suggestedName || 'deck.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return { path: r.filePath };
});

ipcMain.handle('shell:showItem', async (_e, absPath) => {
  shell.showItemInFolder(absPath);
});

ipcMain.handle('win:min', () => mainWindow?.minimize());
ipcMain.handle('win:max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('win:close', () => mainWindow?.close());

// ---------- 放映窗口 ----------
let presentWin = null;

ipcMain.handle('present:open', async () => {
  if (presentWin && !presentWin.isDestroyed()) {
    presentWin.focus();
    return { ok: true };
  }
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  // 目标屏：主窗口中心不在的那块（副屏）；单屏时用当前屏
  let target = displays[0];
  if (displays.length > 1 && mainWindow) {
    const b = mainWindow.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const other = displays.find(
      (d) => !(cx >= d.workArea.x && cx < d.workArea.x + d.workArea.width && cy >= d.workArea.y && cy < d.workArea.y + d.workArea.height),
    );
    if (other) target = other;
  }
  presentWin = new BrowserWindow({
    frame: false,
    backgroundColor: '#000000',
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Windows 下 constructor 传 fullscreen + 坐标会失效（窗口悬浮不全屏）：
  // 先按目标屏 bounds 建窗，ready 后再进全屏
  presentWin.once('ready-to-show', () => {
    try {
      presentWin.setBounds(target.bounds);
      presentWin.setFullScreen(true);
      presentWin.setMenuBarVisibility(false);
    } catch (_) { /* 窗口可能已关 */ }
  });
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  presentWin.loadFile(indexPath, { hash: 'present' });
  presentWin.on('closed', () => {
    presentWin = null;
    // 退出应用时 mainWindow 可能已销毁（先于放映窗关闭）——发消息前必须查活
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('present:event', { type: 'end' });
    }
  });
  return { ok: true, display: target.id };
});

ipcMain.handle('present:close', () => {
  presentWin?.close();
});

// 交换放映窗与主窗（监看）所在屏幕：多屏演讲时放映/监看互换
// Windows 下直接搬全屏窗会保留旧屏尺寸/DPI——先退全屏、setBounds 到目标屏、再进全屏
ipcMain.handle('present:swapScreens', async () => {
  if (!presentWin || presentWin.isDestroyed()) return { ok: false, error: 'no-present-window' };
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-main-window' };
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return { ok: false, error: 'single-display' };
  // 先取两窗当前所在屏（搬动前快照）
  const dPresent = screen.getDisplayMatching(presentWin.getBounds());
  const dMain = screen.getDisplayMatching(mainWindow.getBounds());
  if (dPresent.id === dMain.id) return { ok: false, error: 'same-display' };

  // 主窗 → 放映窗原屏：保留尺寸（工作区夹紧、居中），还原最大化/全屏态
  const mainBounds = mainWindow.getBounds();
  const wasMax = mainWindow.isMaximized();
  const wasFull = mainWindow.isFullScreen();
  if (wasFull) mainWindow.setFullScreen(false);
  if (wasMax) mainWindow.unmaximize();
  const wa = dPresent.workArea;
  const w = Math.min(mainBounds.width, wa.width);
  const h = Math.min(mainBounds.height, wa.height);
  mainWindow.setBounds({
    x: wa.x + Math.floor((wa.width - w) / 2),
    y: wa.y + Math.floor((wa.height - h) / 2),
    width: w,
    height: h,
  });
  if (wasFull) mainWindow.setFullScreen(true);
  else if (wasMax) mainWindow.maximize();

  // 放映窗 → 主窗原屏：退全屏 → 搬 → 重新全屏
  presentWin.setFullScreen(false);
  presentWin.setBounds(dMain.bounds);
  presentWin.setFullScreen(true);
  return { ok: true };
});

// 编辑器 → 放映窗：整页状态广播（deck 序列化 + 当前页 + 已出现 order）
ipcMain.on('present:state', (_e, payload) => {
  if (presentWin && !presentWin.isDestroyed()) {
    presentWin.webContents.send('present:state', payload);
  }
});

// 放映窗 → 编辑器：事件（advance/reverse/goto/ref/back/ready）
ipcMain.on('present:event', (_e, evt) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('present:event', evt);
  }
});

// ---------- 图片另存（复制原图到指定位置） ----------
ipcMain.handle('media:saveAs', async (_e, { srcPath }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '保存图像',
    defaultPath: path.basename(srcPath),
  });
  if (r.canceled || !r.filePath) return null;
  try {
    fs.copyFileSync(srcPath, r.filePath);
    return { path: r.filePath };
  } catch (e) {
    // 与其他 handler 一致的 {error} 契约（如目标被 PDF 阅读器占用 EBUSY）
    return { error: String(e) };
  }
});

// ---------- PDF 导出（渲染进程准备好打印 DOM 后调用） ----------
ipcMain.handle('pdf:print', async (_e, { savePath }) => {
  try {
    const data = await mainWindow.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    });
    fs.writeFileSync(savePath, data);
    return { path: savePath, bytes: data.length };
  } catch (e) {
    return { error: String(e) };
  }
});

// ---------- 撤销历史持久化（工程目录 .beamer-history.json 隐藏文件） ----------
ipcMain.handle('history:read', (_e, folder) => {
  try {
    if (!folder || typeof folder !== 'string') return null;
    const p = path.join(folder, '.beamer-history.json');
    if (!fs.existsSync(p)) return null;
    return { json: fs.readFileSync(p, 'utf8') };
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('history:write', (_e, { folder, json }) => {
  try {
    if (!folder || typeof folder !== 'string' || typeof json !== 'string') return { error: 'bad args' };
    fs.writeFileSync(path.join(folder, '.beamer-history.json'), json, 'utf8');
    return { ok: true };
  } catch (e) {
    return { error: String(e) };
  }
});

// ---------- 放映录制 ----------
function setupRecordingHandlers() {
  const { session, desktopCapturer } = require('electron');
  // getDisplayMedia 自动选源（无系统选择器）：放映窗所在屏幕 + 系统声音 loopback。
  // 渲染进程 getDisplayMedia({video:{frameRate:60}, audio:true}) 直达这里。
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      let src = sources[0];
      try {
        if (presentWin && !presentWin.isDestroyed()) {
          const b = presentWin.getBounds();
          const cx = b.x + b.width / 2;
          const cy = b.y + b.height / 2;
          const { screen } = require('electron');
          const d = screen.getAllDisplays().find((dd) =>
            cx >= dd.bounds.x && cx < dd.bounds.x + dd.bounds.width
            && cy >= dd.bounds.y && cy < dd.bounds.y + dd.bounds.height);
          if (d) src = sources.find((s) => s.display_id === String(d.id)) || src;
        }
      } catch (_) { /* 定位失败退回主屏 */ }
      // audio: 'loopback' = Windows 系统声音回环采集（放映中的视频/音效）
      callback(src ? { video: src, audio: 'loopback' } : {});
    }).catch(() => callback({}));
  });
  // 麦克风（用户人声）授权：仅放行 media，其余权限维持默认拒绝
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
}

// 录像落盘：默认工程根目录（无工程文件夹时退回「文档」）
ipcMain.handle('rec:save', (_e, { folder, name, data }) => {
  try {
    const dir = folder && typeof folder === 'string' && fs.existsSync(folder)
      ? folder
      : app.getPath('documents');
    const safe = String(name || 'recording.webm').replace(/[^\w.-]/g, '_');
    const p = path.join(dir, safe);
    fs.writeFileSync(p, Buffer.from(data));
    return { path: p };
  } catch (e) {
    return { error: String(e) };
  }
});
