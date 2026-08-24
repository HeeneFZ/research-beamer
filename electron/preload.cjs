const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // e2e 测试模式下禁用自动保存，避免污染示例工程
  isE2E: !!(process.env.E2E_SCREENSHOT || process.env.E2E_PDF || process.env.E2E_EVAL),
  openProject: () => ipcRenderer.invoke('project:open'),
  loadExample: (relPath) => ipcRenderer.invoke('project:loadPath', relPath),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  importMedia: (payload) => ipcRenderer.invoke('media:import', payload),
  ensureEpsPdf: (payload) => ipcRenderer.invoke('media:ensureEpsPdf', payload),
  readFile: (absPath) => ipcRenderer.invoke('file:read', absPath),
  exportPDF: (payload) => ipcRenderer.invoke('export:pdf', payload),
  showItem: (absPath) => ipcRenderer.invoke('shell:showItem', absPath),
  winMin: () => ipcRenderer.invoke('win:min'),
  winMax: () => ipcRenderer.invoke('win:max'),
  winClose: () => ipcRenderer.invoke('win:close'),
  openPresent: () => ipcRenderer.invoke('present:open'),
  closePresent: () => ipcRenderer.invoke('present:close'),
  sendPresentState: (payload) => ipcRenderer.send('present:state', payload),
  sendPresentEvent: (evt) => ipcRenderer.send('present:event', evt),
  onPresentState: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('present:state', h);
    return () => ipcRenderer.removeListener('present:state', h);
  },
  onPresentEvent: (cb) => {
    const h = (_e, evt) => cb(evt);
    ipcRenderer.on('present:event', h);
    return () => ipcRenderer.removeListener('present:event', h);
  },
  saveMediaAs: (p) => ipcRenderer.invoke('media:saveAs', p),
  printPDF: (p) => ipcRenderer.invoke('pdf:print', p),
  readHistory: (folder) => ipcRenderer.invoke('history:read', folder),
  writeHistory: (p) => ipcRenderer.invoke('history:write', p),
  saveRecording: (p) => ipcRenderer.invoke('rec:save', p),
});
