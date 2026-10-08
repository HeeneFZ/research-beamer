// 文件 I/O：异步原子写入与流式素材比较，不占用主进程消息循环。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const writes = new Map();
const imports = new Map();

function serial(map, key, operation) {
  const previous = map.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  map.set(key, next);
  const release = () => { if (map.get(key) === next) map.delete(key); };
  void next.then(release, release);
  return next;
}

function writeFileAtomic(filePath, data) {
  const target = path.resolve(filePath);
  return serial(writes, target, async () => {
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, data, { flag: 'wx' });
      await fs.promises.rename(temporary, target);
    } finally {
      await fs.promises.unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') console.warn('临时文件清理失败：', error);
      });
    }
  });
}

async function readFileAfterWrites(filePath, options) {
  const pending = writes.get(path.resolve(filePath));
  if (pending) await pending.catch(() => {});
  return fs.promises.readFile(filePath, options);
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
  return serial(imports, mediaDir, async () => {
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

module.exports = { writeFileAtomic, readFileAfterWrites, readProjectFromFolder, importMedia };
