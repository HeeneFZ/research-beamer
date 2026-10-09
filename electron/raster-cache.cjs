// Shared final PNGs for editor and projection. At most one final file per source.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { writeFileAtomic } = require('./files.cjs');
const MEMORY_LIMIT = 192 * 1024 * 1024;
const PREFIX = path.join(os.tmpdir(), 'research-beamer-raster-');

function createRasterCache(memoryLimit = MEMORY_LIMIT) {
  let current = null;
  const retired = new Set();
  let operations = Promise.resolve();
  async function removeSession(session) {
    session.closed = true;
    await Promise.allSettled([...session.writes]);
    if (session.folder) {
      const resolved = path.resolve(session.folder);
      if (!resolved.startsWith(PREFIX) || path.dirname(resolved) !== path.resolve(os.tmpdir())) throw new Error('Invalid raster cache cleanup path');
      await fs.promises.rm(resolved, { recursive: true, force: true });
    }
    session.records.clear(); session.bytes = 0;
  }
  async function begin(key) {
    if (current?.key === key && !current.closed) return;
    const old = current;
    current = { key, records: new Map(), bytes: 0, folder: null, writes: new Set(), closed: false };
    if (old) {
      const cleanup = removeSession(old);
      retired.add(cleanup);
      void cleanup.finally(() => retired.delete(cleanup)).catch(() => {});
    }
  }
  async function putImpl({ session: key, abs, data, width, height, aspect, stamp }) {
    const session = current;
    if (!session || session.closed || session.key !== key) throw new Error('Resource session expired');
    if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 64 * 1024 * 1024 && aspect > 0)) throw new Error('Invalid raster geometry');
    const stats = await fs.promises.stat(abs);
    const actualStamp = `${stats.size}:${stats.mtimeMs}`;
    if (stamp && stamp !== actualStamp) throw new Error('素材在预备过程中发生变化，请重新打开工程');
    const id = crypto.createHash('sha256').update(key + '\0' + abs).digest('hex');
    const previous = session.records.get(id);
    if (previous?.info.width >= width && previous.info.stamp === actualStamp) return previous.info;
    const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const info = { session: key, id, width, height, aspect, stamp: actualStamp, version: (previous?.info.version ?? 0) + 1 };
    if (previous?.data) session.bytes -= previous.data.length;
    const record = { info, data: bytes, file: previous?.file };
    session.records.delete(id); session.records.set(id, record); session.bytes += bytes.length;
    try { for (const [sourceId, item] of session.records) {
      if (session.bytes <= memoryLimit || session.closed) break;
      if (!item.data) continue;
      if (!session.folder) session.folder = await fs.promises.mkdtemp(PREFIX);
      item.file = path.join(session.folder, sourceId + '.png');
      const writing = writeFileAtomic(item.file, item.data);
      session.writes.add(writing);
      try { await writing; } finally { session.writes.delete(writing); }
      session.bytes -= item.data.length; item.data = null;
    } } catch (error) {
      // A failed spill must not leave a failed source consuming unbounded memory.
      session.records.delete(id);
      if (record.data) session.bytes -= record.data.length;
      if (previous) {
        session.records.set(id, previous);
        if (previous.data) session.bytes += previous.data.length;
      }
      throw error;
    }
    if (session.closed || current !== session) throw new Error('Resource session expired');
    return info;
  }
  async function read(key, id) {
    const session = current;
    if (!session || session.closed || session.key !== key) throw new Error('Resource session expired');
    const item = session.records.get(id);
    if (!item) throw new Error('Resource is not prepared');
    return { ...item.info, data: item.data ?? await fs.promises.readFile(item.file) };
  }
  async function close() {
    const session = current; current = null;
    await Promise.allSettled([...retired, ...(session ? [removeSession(session)] : [])]);
  }
  const serial = (operation) => {
    const next = operations.catch(() => {}).then(operation);
    operations = next;
    return next;
  };
  return { begin: (key) => serial(() => begin(key)), put: (payload) => serial(() => putImpl(payload)),
    read: (key, id) => serial(() => read(key, id)), close: () => serial(close) };
}
module.exports = { createRasterCache };
