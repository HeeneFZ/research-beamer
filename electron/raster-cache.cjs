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
  let closed = false;
  const retired = new Set();
  async function removeSession(session) {
    session.closed = true;
    // Accepted puts may still be in stat/mkdtemp, and readers may own the final file.
    await Promise.allSettled([session.putting, session.reading]);
    if (session.folder) {
      const resolved = path.resolve(session.folder);
      if (!resolved.startsWith(PREFIX) || path.dirname(resolved) !== path.resolve(os.tmpdir())) throw new Error('Invalid raster cache cleanup path');
      await fs.promises.rm(resolved, { recursive: true, force: true });
    }
    session.records.clear(); session.bytes = 0;
  }
  function retire(session) {
    const cleanup = removeSession(session);
    retired.add(cleanup);
    void cleanup.finally(() => retired.delete(cleanup)).catch(() => {});
  }
  async function begin(key) {
    if (closed) throw new Error('Raster cache is closed');
    if (current?.key === key && !current.closed) return;
    const old = current;
    current = { key, records: new Map(), bytes: 0, folder: null, putting: Promise.resolve(), reading: Promise.resolve(), closed: false };
    if (old) retire(old);
  }
  async function putImpl(session, { session: key, abs, data, width, height, aspect, stamp }) {
    const valid = () => current === session && !session.closed;
    if (!valid()) throw new Error('Resource session expired');
    if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 64 * 1024 * 1024 && aspect > 0)) throw new Error('Invalid raster geometry');
    const stats = await fs.promises.stat(abs);
    if (!valid()) throw new Error('Resource session expired');
    const actualStamp = `${stats.size}:${stats.mtimeMs}`;
    if (stamp && stamp !== actualStamp) throw new Error('素材在预备过程中发生变化，请重新打开工程');
    const id = crypto.createHash('sha256').update(key + '\0' + abs).digest('hex');
    const previous = session.records.get(id);
    if (previous?.info.width >= width && previous.info.stamp === actualStamp) return previous.info;
    const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const info = { session: key, id, width, height, aspect, stamp: actualStamp, version: (previous?.info.version ?? 0) + 1 };
    if (previous?.data) session.bytes -= previous.data.length;
    const record = { info, data: bytes, file: previous?.file, reads: previous?.reads ?? new Set() };
    session.records.delete(id); session.records.set(id, record); session.bytes += bytes.length;
    try { for (const [sourceId, item] of session.records) {
      if (session.bytes <= memoryLimit || session.closed) break;
      if (!item.data) continue;
      if (!session.folder) session.folder = await fs.promises.mkdtemp(PREFIX);
      if (!valid()) throw new Error('Resource session expired');
      // An upgrade reuses one filename. Finish readers of its previous version first.
      if (item.file) await Promise.allSettled([...item.reads]);
      if (!valid()) throw new Error('Resource session expired');
      item.file = path.join(session.folder, sourceId + '.png');
      await writeFileAtomic(item.file, item.data);
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
    if (!valid()) throw new Error('Resource session expired');
    return info;
  }
  function put(payload) {
    const session = current;
    if (!session || session.closed || session.key !== payload.session) return Promise.reject(new Error('Resource session expired'));
    const task = session.putting.catch(() => {}).then(() => putImpl(session, payload));
    session.putting = task;
    return task;
  }
  async function read(key, id) {
    const session = current;
    if (!session || session.closed || session.key !== key) throw new Error('Resource session expired');
    const item = session.records.get(id);
    if (!item) throw new Error('Resource is not prepared');
    // Capture metadata and bytes together. An in-progress spill still owns its RAM data.
    const info = item.info, data = item.data, file = item.file;
    const task = session.reading.catch(() => {}).then(async () => {
      if (session.closed) throw new Error('Resource session expired');
      return { ...info, data: data ?? await fs.promises.readFile(file) };
    });
    session.reading = task;
    item.reads.add(task);
    const release = () => item.reads.delete(task);
    void task.then(release, release);
    return task;
  }
  async function close() {
    closed = true;
    const session = current; current = null;
    if (session) retire(session);
    await Promise.allSettled([...retired]);
  }
  return { begin, put, read, close };
}
module.exports = { createRasterCache };
