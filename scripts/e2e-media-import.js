// 媒体导入去重回归探针：同一素材重复导入不得产生 -N 副本（曾致 media 塞满重复大文件、
// deck.md 引用副本名、副本被清后放映窗裂图）。三个断言：
//   A 首次导入 → 原名复制
//   B 同内容重复导入 → 复用原名（不产生 -1）
//   C 同名不同内容 → 加序号另存（保留原语义，不覆盖）
// 目标工程用临时目录，不污染示例副本。fixture 预置（复跑前执行）：
//   清空 test_shots/tmp-e2e-import；把 examples/zh_talk/media/1.jpg 复制为
//   test_shots/tmp-e2e-src/curve.png（与 curve.png 同名不同内容）
(async () => {
  const TMP = 'E:/projects/ai/BeamerApp/test_shots/tmp-e2e-import';
  const SRC_DIR = 'E:/projects/ai/BeamerApp/test_shots/tmp-e2e-src';
  const out = {};
  // 源素材：仓库示例图（内容 A）+ 同名不同内容（内容 B，启动脚本预置）
  const srcA = 'E:/projects/ai/BeamerApp/examples/zh_talk/media/curve.png';
  const srcB = SRC_DIR + '/curve.png'; // 同名异内容
  const r1 = await window.api.importMedia({ srcPath: srcA, folder: TMP });
  const r2 = await window.api.importMedia({ srcPath: srcA, folder: TMP });
  const r3 = await window.api.importMedia({ srcPath: srcB, folder: TMP });
  out.first = r1.fileName;
  out.dup = r2.fileName;
  out.diffContent = r3.fileName;
  out.passA = r1.fileName === 'curve.png';
  out.passB = r2.fileName === 'curve.png'; // 旧逻辑此处返回 curve-1.png
  out.passC = r3.fileName === 'curve-1.png'; // 同名异内容仍加序号（序号插在主名与扩展名之间）
  return out;
})()
