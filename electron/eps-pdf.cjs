// Deduplicate conversions and publish only complete, current output.
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { execFile } = require('child_process');
const { writeFileAtomic } = require('./files.cjs');
const cacheFolder = path.join(require('os').tmpdir(), 'research-beamer-eps');
const sourceStamp = (info) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;

function createEpsConverter(findGhostscript) {
  const inflight = new Map();
  return async function ensureEpsPdf(absPath) {
    const source = path.resolve(absPath);
    let before;
    try { before = await fs.promises.stat(source); }
    catch (error) { return { error: String(error) }; }
    const stamp = sourceStamp(before), pending = inflight.get(source);
    if (pending) {
      if (pending.stamp === stamp) return pending.promise;
      // A new revision must not adopt an obsolete conversion's result/error.
      await pending.promise;
      return ensureEpsPdf(source);
    }
    // A same-stem PDF may be a separate user asset, so never use or overwrite it.
    const output = path.join(cacheFolder, createHash('sha256').update(source).digest('hex') + '.pdf');
    const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp.pdf`);
    const job = (async () => {
      const cached = await fs.promises.stat(output).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const recorded = await fs.promises.readFile(output + '.stamp', 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (cached?.isFile() && cached.size > 0 && recorded === stamp) return { pdf: output };
      const gs = findGhostscript();
      if (!gs) throw new Error('Ghostscript not found');
      await fs.promises.mkdir(cacheFolder, { recursive: true });
      await new Promise((resolve, reject) => execFile(gs,
        ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=pdfwrite', '-o', temporary, source],
        { timeout: 30000, killSignal: 'SIGKILL' }, (error) => error ? reject(error) : resolve()));
      const [after, converted] = await Promise.all([fs.promises.stat(source), fs.promises.stat(temporary)]);
      if (stamp !== sourceStamp(after)) throw new Error('EPS 素材在转换过程中发生变化，请重试');
      if (!converted.isFile() || !converted.size) throw new Error('EPS 转换未生成有效文件');
      await fs.promises.rename(temporary, output);
      await writeFileAtomic(output + '.stamp', stamp);
      return { pdf: output };
    })().catch((error) => ({ error: String(error) })).finally(async () => {
      inflight.delete(source);
      await fs.promises.unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') console.warn('EPS 临时文件清理失败：', error);
      });
    });
    inflight.set(source, { stamp, promise: job });
    return job;
  };
}

module.exports = { createEpsConverter };
