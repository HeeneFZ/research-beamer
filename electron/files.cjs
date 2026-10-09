// 文件 I/O：异步原子写入与流式素材比较，不占用主进程消息循环。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const writes = new Map();
const imports = new Map();

const queueKey = (filePath) => {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

function serial(map, key, operation) {
  const previous = map.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  map.set(key, next);
  const release = () => { if (map.get(key) === next) map.delete(key); };
  void next.then(release, release);
  return next;
}

async function atomicImpl(target, write) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    await write(temporary);
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') console.warn('临时文件清理失败：', error);
    });
  }
}

function writeFileAtomic(filePath, data) {
  const target = path.resolve(filePath);
  return serial(writes, queueKey(target), () => atomicImpl(target,
    (temporary) => fs.promises.writeFile(temporary, data, { flag: 'wx' })));
}

function writeGeneratedAtomic(filePath, produce) {
  const target = path.resolve(filePath);
  // Capture the prepared document now; an earlier file operation may outlive its renderer.
  const generated = (async () => produce())();
  void generated.catch(() => {});
  return serial(writes, queueKey(target), async () => {
    const data = await generated;
    await atomicImpl(target, (temporary) => fs.promises.writeFile(temporary, data, { flag: 'wx' }));
    return data;
  });
}

function copyFileTracked(srcPath, filePath, flags = 0) {
  const source = path.resolve(srcPath), target = path.resolve(filePath);
  return serial(writes, queueKey(target), async () => {
    if (queueKey(source) === queueKey(target)) { await fs.promises.stat(source); return; }
    // Exclusive copies must retain their no-overwrite guarantee, including other processes.
    if (flags & fs.constants.COPYFILE_EXCL) return fs.promises.copyFile(source, target, flags);
    return atomicImpl(target, (temporary) => fs.promises.copyFile(source, temporary, fs.constants.COPYFILE_EXCL));
  });
}

function saveProjectToFolder(folder, md, skillPath) {
  const target = path.resolve(folder, 'deck.md');
  // Register before mkdir: later saves and reads wait for the entire accepted transaction.
  return serial(writes, queueKey(target), async () => {
    await fs.promises.mkdir(path.resolve(folder, 'media'), { recursive: true });
    await atomicImpl(target, (temporary) => fs.promises.writeFile(temporary, md, { flag: 'wx' }));
    await copyFileTracked(skillPath, path.resolve(folder, 'SKILL.md'), fs.constants.COPYFILE_EXCL)
      .catch((error) => { if (error.code !== 'EEXIST') throw error; });
  });
}

async function waitForWrites(filePath) {
  const key = queueKey(filePath);
  let pending;
  while ((pending = writes.get(key))) await pending.catch(() => {});
}

async function readFileAfterWrites(filePath, options) {
  await waitForWrites(filePath);
  return fs.promises.readFile(filePath, options);
}

async function readFileStamped(filePath) {
  await waitForWrites(filePath);
  const before = await fs.promises.stat(filePath);
  const data = await fs.promises.readFile(filePath);
  const after = await fs.promises.stat(filePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('素材在读取过程中发生变化，请重试');
  return { data: new Uint8Array(data), stamp: `${after.size}:${after.mtimeMs}` };
}

/** Finish writes already accepted by Main, even if their renderer has exited. */
async function drainFileWrites() {
  while (writes.size || imports.size) {
    await Promise.allSettled([...writes.values(), ...imports.values()]);
  }
}

async function readProjectFromFolder(folder) {
  try {
    return { md: await readFileAfterWrites(path.join(folder, 'deck.md'), 'utf8'), folder };
  } catch (error) {
    if (error.code === 'ENOENT') return { md: null, folder };
    throw error;
  }
}

function fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function importMedia(srcPath, folder) {
  const mediaDir = path.resolve(folder, 'media');
  return serial(imports, queueKey(mediaDir), async () => {
    await fs.promises.mkdir(mediaDir, { recursive: true });
    const source = await fs.promises.stat(srcPath);
    const name = path.basename(srcPath);
    const extension = path.extname(name);
    let sourceHash;
    for (let index = 0; ; index++) {
      const fileName = index ? `${path.basename(name, extension)}-${index}${extension}` : name;
      const destination = path.join(mediaDir, fileName);
      const existing = await fs.promises.stat(destination).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (existing) {
        if (existing.isFile() && existing.size === source.size) {
          sourceHash ||= fileHash(srcPath);
          const [a, b] = await Promise.all([sourceHash, fileHash(destination)]);
          if (a === b) return { fileName };
        }
        continue;
      }
      try {
        await fs.promises.copyFile(srcPath, destination, fs.constants.COPYFILE_EXCL);
        return { fileName };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  });
}

module.exports = { writeFileAtomic, writeGeneratedAtomic, copyFileTracked, saveProjectToFolder, readFileAfterWrites, readFileStamped, drainFileWrites, readProjectFromFolder, importMedia };
