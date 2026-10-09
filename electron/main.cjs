// Electron main process (plain CJS, no build step needed)
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { writeFileAtomic, writeGeneratedAtomic, copyFileTracked, saveProjectToFolder, readFileAfterWrites, readFileStamped, drainFileWrites, readProjectFromFolder, importMedia } = require('./files.cjs');
const { createRasterCache } = require('./raster-cache.cjs');
const rasterCache = createRasterCache();
const pendingFileOps = new Set();
function trackFileOperation(task) {
  pendingFileOps.add(task);
  const release = () => pendingFileOps.delete(task);
  void task.then(release, release);
  return task;
}
// Split the display cache allowance between two renderers; leave room for transient decode.
ipcMain.handle('display:memory-budget', () => Math.min(4.5 * 1024 ** 3, Math.max(256 * 1024 ** 2, Math.floor(require('os').totalmem() / 8))));
ipcMain.handle('display:targets', () => require('electron').screen.getAllDisplays().map((display) => ({
  width: display.bounds.width, height: display.bounds.height, scaleFactor: display.scaleFactor,
})));

// E2E 模式用独立 userData：不与用户正开着的实例抢单实例锁，也不碰用户示例副本
if (process.env.E2E_SCREENSHOT || process.env.E2E_PDF || process.env.E2E_EVAL) {
  app.setPath('userData', require('path').join(require('os').tmpdir(), 'beamerapp-e2e'));
}

let mainWindow = null;
let mainCloseReady = false;
let managedMainClose = false;
let mainClosePending = null;
let mainCloseGeneration = 0;
let quitRequested = false;
let mainRendererUnavailable = false;
let mainCloseFallbackTimer = null;

function cancelMainCloseFallback() {
  clearTimeout(mainCloseFallbackTimer);
  mainCloseFallbackTimer = null;
}

function waitForMainCloseReady() {
  cancelMainCloseFallback();
  const pending = mainClosePending;
  if (!pending || mainCloseReady) return;
  mainCloseFallbackTimer = setTimeout(() => {
    if (!mainCloseReady && mainClosePending === pending) void offerUnavailableMainClose(pending);
  }, 10000);
}

async function offerUnavailableMainClose(pending) {
  if (mainClosePending !== pending || pending.dialog || pending.window.isDestroyed()) return;
  pending.dialog = true;
  try {
    const result = await dialog.showMessageBox(pending.window, {
      type: 'warning', title: '关闭 Research Beamer',
      message: '编辑窗口未能完成保存确认',
      detail: '可以取消关闭并等待窗口恢复，或关闭窗口并丢弃尚未保存的修改。',
      buttons: ['取消', '丢弃并关闭'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (mainClosePending !== pending || pending.window.isDestroyed() || mainCloseReady && !mainRendererUnavailable) return;
    mainClosePending = null;
    if (result.response !== 1) { quitRequested = false; return; }
    managedMainClose = true;
    pending.window.close();
  } catch (_) {
    if (mainClosePending === pending) { mainClosePending = null; quitRequested = false; }
  }
}

function sendMainCloseRequest() {
  if (mainCloseReady && mainClosePending && !mainClosePending.window.isDestroyed()) {
    mainClosePending.window.webContents.send('win:close-request', mainClosePending.requestId);
  }
}

ipcMain.on('win:close-ready', (event) => {
  if (event.sender !== mainWindow?.webContents) return;
  mainCloseReady = true;
  mainRendererUnavailable = false;
  cancelMainCloseFallback();
  sendMainCloseRequest();
});
ipcMain.handle('win:close-result', (event, { requestId, approved }) => {
  const pending = mainClosePending;
  if (!pending || pending.requestId !== requestId || event.sender !== pending.window.webContents) return false;
  mainClosePending = null;
  cancelMainCloseFallback();
  if (!approved) { quitRequested = false; return false; }
  if (pending.window !== mainWindow || pending.window.isDestroyed()) return false;
  managedMainClose = true;
  setImmediate(() => { if (!pending.window.isDestroyed()) pending.window.close(); });
  return true;
});

function createWindow() {
  mainCloseReady = false; managedMainClose = false; mainClosePending = null; mainRendererUnavailable = false;
  cancelMainCloseFallback();
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
      backgroundThrottling: false, // Editor and projector must keep their frame clocks across monitors.
    },
  });
  const createdMainWindow = mainWindow;
  mainWindow.on('close', (event) => {
    if (managedMainClose) return;
    event.preventDefault();
    if (!mainClosePending) {
      mainClosePending = { window: createdMainWindow, requestId: ++mainCloseGeneration };
      sendMainCloseRequest();
      if (mainRendererUnavailable) void offerUnavailableMainClose(mainClosePending);
      else waitForMainCloseReady();
    }
  });
  mainWindow.webContents.on('did-start-loading', () => {
    if (mainWindow !== createdMainWindow) return;
    // The reloaded editor owns a new store/session; retire its predecessor's projection.
    if (presentWin && !presentWin.isDestroyed()) void closePresentation();
    mainCloseReady = false;
    mainRendererUnavailable = false;
    if (mainClosePending) mainClosePending.requestId = ++mainCloseGeneration;
    waitForMainCloseReady();
  });
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  void mainWindow.loadFile(indexPath, { hash: process.env.E2E_EXAMPLE ? `example=${process.env.E2E_EXAMPLE}` : '' }).catch((error) => {
    console.error('主窗口加载失败：', error);
    if (!createdMainWindow.isDestroyed()) createdMainWindow.show();
  });
  // 关闭后置空：放映窗存活时主窗先关（window-all-closed 不触发），second-instance
  // 再进 if (mainWindow) 会对已销毁窗口调 isMinimized() 抛 "Object has been destroyed"
  mainWindow.on('closed', () => {
    mainWindow = null;
    mainClosePending = null;
    cancelMainCloseFallback();
    void closePresentation();
  });
  // 首帧后再显示（配合 show:false 防白屏）；⚠ 此行丢失 = 窗口永不显示（第卅三轮实测事故）
  mainWindow.once('ready-to-show', () => {
    if (mainWindow === createdMainWindow && !createdMainWindow.isDestroyed()) createdMainWindow.show();
  });
  let reloaded = false;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('render-process-gone', details?.reason);
    if (mainWindow === createdMainWindow) {
      mainRendererUnavailable = true;
      void closePresentation();
      if (mainClosePending) void offerUnavailableMainClose(mainClosePending);
    }
    if (!reloaded && details?.reason !== 'clean-exit') {
      reloaded = true;
      setTimeout(() => {
        if (mainWindow === createdMainWindow && !createdMainWindow.isDestroyed()) createdMainWindow.reload();
      }, 300);
    }
  });
  mainWindow.webContents.on('unresponsive', () => {
    if (mainWindow === createdMainWindow) {
      mainRendererUnavailable = true;
      if (mainClosePending) void offerUnavailableMainClose(mainClosePending);
    }
    setTimeout(() => {
      if (mainWindow !== createdMainWindow || createdMainWindow.isDestroyed()) return;
      try { createdMainWindow.webContents.stop(); } catch (_) { /* ignore */ }
    }, 5000);
  });
  mainWindow.webContents.on('responsive', () => { if (mainWindow === createdMainWindow) mainRendererUnavailable = false; });
  mainWindow.webContents.on('did-fail-load', (_e, code, _description, _url, isMainFrame) => {
    if (mainWindow !== createdMainWindow || code === -3 || isMainFrame === false) return;
    mainRendererUnavailable = true;
    if (mainClosePending) void offerUnavailableMainClose(mainClosePending);
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
              let requireContent = false;
              try {
                requireContent = await wc.executeJavaScript(`!!window.__shotSeq[${i}].requireContent`);
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
                if (requireContent) {
                  if (!BrowserWindow.fromWebContents(wc)?.isVisible()) throw new Error('投影窗口不可见');
                  const pixels = img.toBitmap();
                  let samples = 0, painted = 0;
                  for (let p = 0; p + 3 < pixels.length; p += 256) {
                    samples++; if (pixels[p] + pixels[p + 1] + pixels[p + 2] > 60) painted++;
                  }
                  if (!samples || painted / samples < .05) throw new Error('投影截图为空或黑屏');
                  console.log('E2E_PAINTED=' + (painted / samples).toFixed(3));
                }
                const safe = String(tag ? tag + '-' + step : step || ('shot' + i)).replace(/[^-\w.]/g, '_');
                fs.writeFileSync(require('path').join(process.env.E2E_SHOT_DIR, safe + '.png'), img.toPNG());
                console.log('E2E_SHOT ' + safe + ' ' + img.getSize().width + 'x' + img.getSize().height);
              } catch (er) {
                if (requireContent) throw er;
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
      if (!closingCache && !quitRequested && (!mainWindow || mainWindow.isDestroyed())) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitRequested) app.quit();
});
let closingCache = false;
let cacheClosed = false;
app.on('before-quit', (event) => {
  if (cacheClosed) return;
  event.preventDefault();
  if (closingCache) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    quitRequested = true;
    mainWindow.close();
    return;
  }
  if (presentWin && !presentWin.isDestroyed()) { void closePresentation(); return; }
  closingCache = true;
  void (async () => {
    // Renderer lifetime does not shorten accepted saves, copies, or template loads.
    while (pendingFileOps.size) await Promise.allSettled([...pendingFileOps]);
    await drainFileWrites();
    await rasterCache.close();
  })().finally(() => { cacheClosed = true; app.quit(); });
});

ipcMain.handle('raster:begin', async (event, session) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('Only the editor can prepare a project');
  await rasterCache.begin(session);
});
ipcMain.handle('raster:put', async (event, payload) => {
  if (event.sender !== mainWindow?.webContents && event.sender !== presentWin?.webContents) throw new Error('Unknown renderer');
  return rasterCache.put(payload);
});
ipcMain.handle('raster:read', async (_event, { session, id }) => rasterCache.read(session, id));

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

// ---------- IPC ----------

// 解析示例/相对工程路径：开发时在应用目录；打包后在 resources，首次访问复制到 userData（可写，自动保存才能工作）
// Editable copies are user projects. Template upgrades get a separate version directory.
const EXAMPLE_VERSION = '8';
function copyMissingExample(srcDir, writableDir) {
  if (fs.existsSync(writableDir) || !fs.existsSync(srcDir)) return;
  const parent = path.resolve(path.dirname(writableDir));
  fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, '.beamer-example-'));
  try {
    fs.cpSync(srcDir, temporary, { recursive: true });
    if (!fs.existsSync(writableDir)) fs.renameSync(temporary, writableDir);
  } finally {
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('.beamer-example-')) throw new Error('Invalid example cache cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
function resolveProjectFolder(relPath) {
  if (path.isAbsolute(relPath)) return relPath;
  if (!app.isPackaged) return path.join(app.getAppPath(), relPath);
  const srcDir = path.join(process.resourcesPath, relPath);
  let writableDir = path.join(app.getPath('userData'), relPath);
  if (/^examples(?:[\\/]|$)/.test(relPath)) {
    const verFile = path.join(app.getPath('userData'), 'examples', '.version');
    const curVer = fs.existsSync(verFile) ? fs.readFileSync(verFile, 'utf8') : '';
    let exampleRoot = path.join(app.getPath('userData'), 'examples');
    if (curVer !== EXAMPLE_VERSION) {
      exampleRoot = path.join(app.getPath('userData'), 'example-templates', 'v' + EXAMPLE_VERSION);
      copyMissingExample(path.join(process.resourcesPath, 'examples'), exampleRoot);
    }
    // Both shipped examples remain discoverable through Open, even when startup selects zh.
    for (const name of ['zh_talk', 'en_talk']) copyMissingExample(path.join(process.resourcesPath, 'examples', name), path.join(exampleRoot, name));
    writableDir = path.join(exampleRoot, relPath.replace(/^examples[\\/]?/, ''));
  }
  copyMissingExample(srcDir, writableDir);
  return fs.existsSync(writableDir) ? writableDir : srcDir;
}

async function loadProjectPath(relPath) {
  try {
    const folder = resolveProjectFolder(relPath);
    const project = await readProjectFromFolder(folder);
    return project.md == null ? null : project;
  } catch (e) {
    return { error: String(e) };
  }
}
ipcMain.handle('project:loadPath', (_e, relPath) => trackFileOperation(loadProjectPath(relPath)));

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '打开 PPT 工程',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const folder = r.filePaths[0];
  try {
    return await readProjectFromFolder(folder);
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('project:confirm-exit', async (event, { title, language, reason }) => {
  if (event.sender !== mainWindow?.webContents) return 'cancel';
  const zh = language !== 'en';
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'question', noLink: true, defaultId: 0, cancelId: 2,
    buttons: zh ? ['保存', '不保存', '取消'] : ['Save', 'Discard', 'Cancel'],
    title: zh ? '保存工程修改' : 'Save project changes',
    message: zh ? `是否保存“${title || '未命名工程'}”的修改？` : `Save changes to “${title || 'Untitled project'}”?`,
    detail: zh ? (reason === 'close' ? '保存后关闭窗口；不保存将放弃未保存的修改。' : '保存后切换工程；不保存将放弃未保存的修改。')
      : (reason === 'close' ? 'Save before closing. Discard will lose the unsaved changes.' : 'Save before switching projects. Discard will lose the unsaved changes.'),
  });
  return ['save', 'discard', 'cancel'][choice.response] ?? 'cancel';
});

async function saveProjectToDisk({ folder, md }) {
  try {
    if (!folder) {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '选择工程保存文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      folder = r.filePaths[0];
    }
    await saveProjectToFolder(folder, md, path.join(__dirname, '..', 'skills', 'research-beamer-deck', 'SKILL.md'));
    return { folder };
  } catch (e) {
    return { error: String(e) };
  }
}
ipcMain.handle('project:save', (_e, payload) => trackFileOperation(saveProjectToDisk(payload)));

// 图片/视频导入工程 media/（仅复制文件）
// 同名已存在：内容一致 → 复用现有文件（同一素材多处引用不再产生 -N 副本；
// 曾因无条件加序号，media 目录被塞满重复大文件，且 deck.md 引用的是副本名，
// 副本一旦被清掉，放映窗（独立进程冷加载 file://）即裂图）；同名不同内容 →
// 加序号另存，不覆盖既有文件
ipcMain.handle('media:import', async (_e, { srcPath, folder }) => {
  try {
    if (!folder) return { error: 'no folder' };
    return await importMedia(srcPath, folder);
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
const ensureEpsPdf = require('./eps-pdf.cjs').createEpsConverter(findGhostscript);
ipcMain.handle('media:ensureEpsPdf', (_e, { absPath }) => ensureEpsPdf(absPath));

// 异步读（大 PDF/视频可达几十 MB；readFileSync 会卡主进程消息循环）
ipcMain.handle('file:read', async (_e, absPath) => {
  try {
    return await readFileStamped(absPath);
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
let presentLoading = null;
const presentationSessions = new WeakMap();
const managedPresentationClose = new WeakSet();

ipcMain.handle('present:open', async (_event, payload) => {
  const opening = ++closeGen;
  presentClosing = false;
  if (suspendWaiter) suspendWaiter();
  if (flushWaiter) flushWaiter();
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
  if (presentWin && !presentWin.isDestroyed()) {
    const existing = presentWin;
    if (payload?.session) presentationSessions.set(existing, payload.session);
    const loading = presentLoading?.window === existing ? presentLoading.promise : null;
    if (loading) {
      const result = await loading;
      if (!result.ok) return result;
    }
    if (opening !== closeGen || existing !== presentWin || existing.isDestroyed()) return { ok: false, error: '放映启动已取消' };
    const previous = screen.getDisplayMatching(existing.getBounds());
    if (previous.id !== target.id) {
      existing.setFullScreen(false); existing.setBounds(target.bounds);
    }
    if (!existing.isFullScreen()) existing.setFullScreen(true);
    existing.webContents.send('present:ctrl', { type: 'resume', session: presentationSessions.get(existing) });
    existing.show(); existing.focus();
    mainWindow?.webContents.send('present:event', { type: 'ready', session: presentationSessions.get(existing) });
    return { ok: true, display: target.id };
  }
  const created = new BrowserWindow({
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
      backgroundThrottling: false,
    },
  });
  presentWin = created;
  if (payload?.session) presentationSessions.set(created, payload.session);
  // Windows 下 constructor 传 fullscreen + 坐标会失效（窗口悬浮不全屏）：
  // 先按目标屏 bounds 建窗，ready 后再进全屏
  created.once('ready-to-show', () => {
    if (opening !== closeGen) return;
    try {
      created.setBounds(target.bounds);
      created.setFullScreen(true);
      created.setMenuBarVisibility(false);
    } catch (_) { /* 窗口可能已关 */ }
  });
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  let failedLoad = false;
  created.on('close', (event) => {
    if (managedPresentationClose.has(created) || !(presentRecording || presentFlushing)) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('present:event', { type: 'end', session: presentationSessions.get(created) });
    void closePresentation();
  });
  created.on('closed', () => {
    if (presentWin !== created) return;
    presentWin = null;
    if (presentLoading?.window === created) presentLoading = null;
    presentRecording = false; // 窗毁录制链已断，防下次 close 误等
    presentFlushing = 0;
    // 窗口被旁路销毁（Alt+F4）时使挂起的延迟关闭失效：不清则 presentClosing
    // 卡最长 30s，期间新放映的「结束放映」被吞（窗口关不掉），或滞留的旧
    // close 计时到点按陈旧 generation 判定通过、关掉【新】放映窗（数据丢失类）
    closeGen++;
    presentClosing = false;
    if (suspendWaiter) suspendWaiter();
    if (flushWaiter) flushWaiter();
    // 退出应用时 mainWindow 可能已销毁（先于放映窗关闭）——发消息前必须查活
    if (!failedLoad && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('present:event', { type: 'end', session: presentationSessions.get(created) });
    }
  });
  created.webContents.on('render-process-gone', (_event, details) => {
    if (presentWin !== created || created.isDestroyed()) return;
    console.error('放映进程退出：', details.reason);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('present:event', {
        type: 'error', session: presentationSessions.get(created),
        label: '放映窗口意外退出' + (presentFlushing ? '，未完成保存的录像无法恢复' : ''),
      });
    }
    // A dead renderer cannot acknowledge suspension or finish a recording write.
    // Its closed handler releases waiters; never kill a live renderer for a slow save.
    created.destroy();
  });
  const loading = created.loadFile(indexPath, { hash: 'present' }).then(() => ({ ok: true }), (error) => {
    failedLoad = true;
    if (!created.isDestroyed()) created.destroy();
    return { ok: false, error: String(error) };
  });
  presentLoading = { window: created, promise: loading };
  const result = await loading;
  if (presentLoading?.window === created) presentLoading = null;
  if (!result.ok) return result;
  if (opening !== closeGen) return { ok: false, error: '放映启动已取消' };
  if (created.isDestroyed()) return { ok: false, error: '投影窗口已关闭' };
  return { ok: true, display: target.id };
});

// 结束放映：录制中或落盘链在途则先等 ack 再关窗——直接销毁渲染进程会让
// onstop 的异步落盘链（Blob→arrayBuffer→IPC）竞态窗口销毁，录像整段丢失。
// recStopped 由渲染进程 onstop 的 finally 发出（保存成功/失败/空块全路径）；
// 保存可能超过 30s（长录像或慢盘），不得以超时销毁仍在落盘的渲染进程。
// closeGen 防「结束→立刻重开放映」竞态：
// 复用存活窗口的 present:open 使挂起的关闭作废，否则延迟关窗会杀掉新放映。
let presentRecording = false;  // recState UI 镜像（按钮态）
let presentFlushing = 0;      // 在途落盘会话数（recState on +1 / recStopped -1）
let presentClosing = false;
let closeGen = 0;
let flushWaiter = null;
let suspendWaiter = null;

async function closePresentation() {
  if (!presentWin || presentWin.isDestroyed()) return;
  if (presentClosing) return;
  const gen = ++closeGen;
  const closingWindow = presentWin;
  presentClosing = true;
  try {
    if (presentRecording) {
      presentWin.webContents.send('present:ctrl', { type: 'rec-stop' });
    }
    await new Promise((resolve) => {
      const wake = () => { clearTimeout(timer); if (suspendWaiter === wake) suspendWaiter = null; resolve(); };
      const timer = setTimeout(wake, 30000);
      suspendWaiter = wake;
      closingWindow.webContents.send('present:ctrl', { type: 'suspend', session: presentationSessions.get(closingWindow), closeGeneration: gen });
    });
    if (gen !== closeGen) return;
    // Keep the renderer alive for disk writes, while ending the visible projection promptly.
    if (!closingWindow.isDestroyed()) closingWindow.hide();
    if (presentFlushing) {
      await new Promise((resolve) => {
        const wake = () => {
          if (flushWaiter === wake) flushWaiter = null;
          resolve();
        };
        flushWaiter = wake;
      });
    }
  } catch (_) { /* 窗口已销毁 */ }
  if (gen !== closeGen) return; // 等待期间放映被重新打开：放弃关闭
  presentClosing = false;
  if (presentWin && !presentWin.isDestroyed()) {
    if (mainWindow && !mainWindow.isDestroyed()) presentWin.hide();
    else { managedPresentationClose.add(presentWin); presentWin.close(); }
  }
}
ipcMain.handle('present:close', closePresentation);

// 交换放映窗与主窗（监看）所在屏幕：多屏演讲时放映/监看互换
// Windows 下直接搬全屏窗会保留旧屏尺寸/DPI——先退全屏、setBounds 到目标屏、再进全屏
ipcMain.handle('present:swapScreens', async () => {
  if (!presentWin || presentWin.isDestroyed() || !presentWin.isVisible()) return { ok: false, error: 'no-present-window' };
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
    const session = presentationSessions.get(presentWin);
    if (session && payload.presentSession !== session) return;
    presentWin.webContents.send('present:state', payload);
  }
});

// 放映窗 → 编辑器：事件（advance/reverse/goto/ref/back/ready/recState/recStopped）。
// recState/recStopped 同时在主进程留痕：present:close 据此决定是否等落盘再关窗。
// recState 只反映按钮态（stop 瞬间即 off，而 onstop 落盘仍在途）；落盘完成的
// 权威信号是 recStopped（渲染进程 onstop 的 finally 全路径发出）。
// 会话计数：停 A 后立刻重录 B 时，A 的 recStopped 迟到——布尔标记会被它清掉，
// B 的落盘保护失效（close 直杀落盘链）。计数保证每个在途会话各自抵消
ipcMain.on('present:event', (_e, evt) => {
  if (!evt.session && presentWin && _e.sender === presentWin.webContents) evt = { ...evt, session: presentationSessions.get(presentWin) };
  if (evt.type === 'ready' && suspendWaiter && presentWin && _e.sender === presentWin.webContents) {
    presentWin.webContents.send('present:ctrl', { type: 'suspend', session: presentationSessions.get(presentWin), closeGeneration: closeGen });
  }
  if (evt.type === 'suspended' && Number(evt.label) === closeGen && suspendWaiter && presentWin && _e.sender === presentWin.webContents) suspendWaiter();
  if (evt && evt.type === 'recState' && evt.label === 'on') {
    presentRecording = true;
    presentFlushing++;
  } else if (evt && evt.type === 'recState') {
    presentRecording = false;
  } else if (evt && evt.type === 'recStopped') {
    if (presentFlushing > 0) presentFlushing--;
    if (presentFlushing === 0 && flushWaiter) flushWaiter();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('present:event', evt);
  } else if (evt?.type === 'end') void closePresentation();
});

// 编辑器 → 放映窗：控制命令（放映台的录制/停止按钮等，录制设备在放映窗持有）
ipcMain.on('present:ctrl', (_e, evt) => {
  if (presentWin && !presentWin.isDestroyed()) {
    presentWin.webContents.send('present:ctrl', { ...evt, session: presentationSessions.get(presentWin) });
  }
});

// ---------- 图片另存（复制原图到指定位置） ----------
async function saveMediaCopy({ srcPath }) {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '保存图像',
    defaultPath: path.basename(srcPath),
  });
  if (r.canceled || !r.filePath) return null;
  try {
    await copyFileTracked(srcPath, r.filePath);
    return { path: r.filePath };
  } catch (e) {
    // 与其他 handler 一致的 {error} 契约（如目标被 PDF 阅读器占用 EBUSY）
    return { error: String(e) };
  }
}
ipcMain.handle('media:saveAs', (_e, payload) => trackFileOperation(saveMediaCopy(payload)));

// ---------- PDF 导出（渲染进程准备好打印 DOM 后调用） ----------
async function printProjectPDF(contents, { savePath }) {
  try {
    const data = await writeGeneratedAtomic(savePath, () => contents.printToPDF({
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    }));
    return { path: savePath, bytes: data.length };
  } catch (e) {
    return { error: String(e) };
  }
}
ipcMain.handle('pdf:print', (event, payload) => trackFileOperation(printProjectPDF(event.sender, payload)));

// ---------- 撤销历史持久化（工程目录 .beamer-history.json 隐藏文件） ----------
ipcMain.handle('history:read', async (_e, folder) => {
  try {
    if (!folder || typeof folder !== 'string') return null;
    const p = path.join(folder, '.beamer-history.json');
    return { json: await readFileAfterWrites(p, 'utf8') };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return { error: String(e) };
  }
});

ipcMain.handle('history:write', async (_e, { folder, json }) => {
  try {
    if (!folder || typeof folder !== 'string' || typeof json !== 'string') return { error: 'bad args' };
    await writeFileAtomic(path.join(folder, '.beamer-history.json'), json);
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
ipcMain.handle('rec:save', async (_e, { folder, name, data }) => {
  try {
    const dir = folder && typeof folder === 'string' && fs.existsSync(folder)
      ? folder
      : app.getPath('documents');
    const safe = String(name || 'recording.webm').replace(/[^\w.-]/g, '_');
    const p = path.join(dir, safe);
    await writeFileAtomic(p, Buffer.from(data));
    return { path: p };
  } catch (e) {
    return { error: String(e) };
  }
});
