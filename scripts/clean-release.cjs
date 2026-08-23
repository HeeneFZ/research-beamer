// 打包后清理中间产物，release/ 只保留便携 exe
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'release', 'win-unpacked');
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('cleaned release/win-unpacked');
}
for (const f of ['builder-effective-config.yaml', 'builder-debug.yml']) {
  const p = path.join(__dirname, '..', 'release', f);
  if (fs.existsSync(p)) fs.rmSync(p);
}
const icoDir = path.join(__dirname, '..', 'release', '.icon-ico');
if (fs.existsSync(icoDir)) fs.rmSync(icoDir, { recursive: true, force: true });
