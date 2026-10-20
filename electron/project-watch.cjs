// Watch parent directories so atomic file replacement does not retire the watch.
const fs = require('fs');
const path = require('path');
const { readFileAfterWrites } = require('./files.cjs');

const keyOf = (file) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function stamp(file) {
  try {
    const s = await fs.promises.stat(file);
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
}

function createProjectWatcher(notify) {
  let current = null;
  function stop(id) {
    if (!current || id && current.id !== id) return;
    const scope = current; current = null;
    clearTimeout(scope.timer); clearInterval(scope.poll);
    for (const watcher of scope.dirs.values()) watcher.close();
    scope.dirs.clear();
  }
  function schedule(scope, keys, force = false) {
    if (current !== scope) return;
    for (const key of keys) { scope.pending.add(key); if (force) scope.forced.add(key); }
    clearTimeout(scope.timer);
    scope.timer = setTimeout(() => { scope.timer = null; void scan(scope); }, 180);
  }
  function addDirectory(scope, dir) {
    const key = keyOf(dir);
    if (current !== scope || scope.dirs.has(key)) return true;
    try {
      const watcher = fs.watch(dir, { persistent: false }, (_kind, name) => {
        if (current !== scope) return;
        const changed = name == null ? null : keyOf(path.join(dir, String(name)));
        const keys = [...scope.targets].filter(([target]) => changed == null || target === changed || target.startsWith(changed + path.sep)).map(([target]) => target);
        if (keys.length) {
          // Windows can report a media directory change without changing an
          // asset (for example delayed directory metadata updates). Only an
          // exact file event bypasses fingerprints; ancestor events rescan.
          for (const target of keys) if (target === changed
            || changed == null && (scope.targets.get(target)?.deck || !scope.stamps.has(target))
            || _kind === 'rename' && !scope.stamps.has(target)) scope.forced.add(target);
          schedule(scope, keys); configure(scope);
        }
      });
      watcher.on('error', () => {
        if (scope.dirs.get(key) === watcher) { watcher.close(); scope.dirs.delete(key); scope.retryDirs = true; }
      });
      scope.dirs.set(key, watcher);
      return true;
    } catch (_) { scope.retryDirs = true; return false; }
  }
  function configure(scope) {
    if (current !== scope) return;
    const version = ++scope.setup;
    const parents = new Set([...scope.targets.values()].map((target) => path.dirname(target.path)));
    for (const [dir, watcher] of scope.dirs) {
      if (![...parents].some((parent) => keyOf(parent) === dir || keyOf(parent).startsWith(dir + path.sep))) {
        watcher.close(); scope.dirs.delete(dir);
      }
    }
    scope.retryDirs = false;
    for (const parent of parents) {
      if (addDirectory(scope, parent)) continue;
      // Missing nested media directories can appear after an agent creates them.
      void (async () => {
        let ancestor = path.dirname(parent);
        while (current === scope && version === scope.setup) {
          try {
            const info = await fs.promises.stat(ancestor);
            if (current !== scope || version !== scope.setup) return;
            if (info.isDirectory() && addDirectory(scope, ancestor)) break;
          } catch (_) { /* Try the nearest existing parent; stat polling remains available. */ }
          const next = path.dirname(ancestor);
          if (next === ancestor) break;
          ancestor = next;
        }
        if (current === scope && version === scope.setup) scope.retryDirs = true;
      })();
    }
  }
  async function scan(scope) {
    if (current !== scope || scope.running) return;
    scope.running = true;
    const keys = [...scope.pending], forced = new Set(scope.forced);
    scope.pending.clear(); scope.forced.clear();
    let md, error, media = false;
    const mediaChecks = [];
    const failedAsset = (key, failure) => {
      const failed = 'error:' + String(failure.code ?? failure);
      if (scope.stamps.get(key) !== failed) media = true;
      scope.stamps.set(key, failed);
    };
    try {
      for (const key of keys) {
        if (current !== scope) return;
        const target = scope.targets.get(key);
        if (!target) continue;
        try {
          const next = await stamp(target.path), known = scope.stamps.has(key), previous = scope.stamps.get(key);
          scope.stamps.set(key, next);
          if (known && previous === next && !forced.has(key) && !(target.deck && scope.readError)) continue;
          if (target.deck) {
            const first = await readFileAfterWrites(target.path, 'utf8');
            await pause(80);
            const second = await readFileAfterWrites(target.path, 'utf8');
            if (current !== scope) return;
            if (first !== second) { schedule(scope, [key], true); continue; }
            if (second !== scope.md || scope.readError) { md = second; scope.md = second; scope.readError = false; }
          } else if (known || forced.has(key)) mediaChecks.push({ key, file: target.path, stamp: next });
        } catch (failure) {
          if (target.deck && !scope.readError) { md = null; error = String(failure); scope.readError = true; }
          if (!target.deck) failedAsset(key, failure);
        }
      }
      if (mediaChecks.length && current === scope) {
        // One settling interval for the whole batch, not 80 ms per asset.
        await pause(80);
        await Promise.all(mediaChecks.map(async (check) => {
          if (current !== scope || !scope.targets.has(check.key)) return;
          try {
            const next = await stamp(check.file);
            if (current !== scope || !scope.targets.has(check.key)) return;
            if (next !== check.stamp) schedule(scope, [check.key], true);
            else media = true;
          } catch (failure) { if (current === scope && scope.targets.has(check.key)) failedAsset(check.key, failure); }
        }));
      }
      if (current === scope && (md !== undefined || media || error)) notify({ id: scope.id, folder: scope.folder, ...(md !== undefined ? { md } : {}), ...(error ? { error } : {}), media });
    } finally {
      scope.running = false;
      if (current === scope && scope.pending.size) schedule(scope, scope.pending);
    }
  }
  function watch({ id, folder, md, assets = [] }) {
    if (!id || !folder) { stop(); return; }
    if (!current || current.id !== id || keyOf(current.folder) !== keyOf(folder)) {
      stop();
      const scope = current = { id, folder, md, targets: new Map(), stamps: new Map(), dirs: new Map(), pending: new Set(), forced: new Set(), timer: null, poll: null, running: false, setup: 0, readError: false, retryDirs: false };
      scope.poll = setInterval(() => {
        if (scope.retryDirs) configure(scope);
        schedule(scope, scope.targets.keys());
      }, 2000);
      scope.poll.unref();
    }
    const scope = current, deck = path.resolve(folder, 'deck.md');
    scope.folder = folder;
    const targets = new Map([[keyOf(deck), { path: deck, deck: true }]]);
    for (const asset of assets) if (typeof asset === 'string' && asset) {
      const file = path.resolve(folder, asset);
      if (keyOf(file) !== keyOf(deck)) targets.set(keyOf(file), { path: file, deck: false });
    }
    const addedAssets = [...targets].some(([key, target]) => !target.deck && !scope.targets.has(key));
    scope.targets = targets;
    for (const key of scope.stamps.keys()) if (!targets.has(key)) scope.stamps.delete(key);
    configure(scope);
    // Establish a fresh image generation immediately after arming new targets.
    // An image may already have loaded just before watch IPC was received.
    // Do this once per target set, before the debounced scan/preparation work.
    if (addedAssets) notify({ id: scope.id, folder: scope.folder, media: true });
    // Compare against the text actually loaded, covering read-before-watch races.
    scope.forced.add(keyOf(deck));
    schedule(scope, targets.keys(), false);
  }
  function saved(folder, previous, md) {
    if (current && keyOf(current.folder) === keyOf(folder) && (current.md === previous || current.md === md)) current.md = md;
  }
  return { watch, stop, saved };
}

module.exports = { createProjectWatcher };
