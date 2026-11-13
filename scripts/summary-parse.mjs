/**
 * summary-parse.mjs — 把测试脚本的历史汇总格式解析成 {total, passed, failed}。
 *
 * 单独成模块是为了能被直接单测：test-all.mjs 有顶层执行副作用，import 它就会跑全套。
 *
 * 仓库里现存五种汇总写法，都必须读对：
 *   "Ran 21 tests: 20 passed, 1 failed"   (server/test-api.mjs)
 *   "34 tests: 32 passed, 2 failed"       (scripts/test-spec-security.mjs)
 *   "33 checks: 32 passed, 1 failed"      (scripts/test-image.mjs)
 *   "51 passed, 4 failed"                 (test-inspect / test-reflow-pages / …)
 *   "22 tests passed"                     (ingest/test-edl.mjs)
 *
 * 退出码 0/1 由调用方按子进程真实 exit 判定；这里只负责计数。
 */

/** 从汇总文本里抽 (passed, failed, total)。抽不到返回 null。 */
export function parseSummary(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 每种格式显式标注语义，**不要**用 m.length 猜：
  // "N passed, M failed" 只有 2 个捕获组（m.length===3），曾被当成「只有 passed」，
  // 于是 failed 被丢成 0、total 被读成 passed —— 报告少报失败断言，CI 上看不出来。
  const patterns = [
    // "Ran" 可选：test-spec-security 打的是 "34 tests: 32 passed, 2 failed"。
    { re: /(?:Ran\s+)?(\d+)\s+tests?:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i, kind: 'total' },
    { re: /(\d+)\s+checks?:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i, kind: 'total' },
    { re: /(\d+)\s+passed,\s*(\d+)\s+failed/i, kind: 'pair' },
    { re: /(\d+)\s+tests?\s+passed/i, kind: 'all' },
    { re: /^(\d+)\s+passed$/i, kind: 'all' },
  ];
  // **从后往前**逐行找，而不是在整段尾部文本里取第一个匹配：
  // 测试用例名本身可能含汇总格式字符串（如 "✓ 格式读对：34 tests: 32 passed, 2 failed"），
  // 取第一个匹配会把用例名当成汇总。真实汇总永远是最后一条像汇总的行。
  const start = Math.max(0, lines.length - 12);
  for (let i = lines.length - 1; i >= start; i--) {
    for (const { re, kind } of patterns) {
      const m = lines[i].match(re);
      if (!m) continue;
      if (kind === 'total') {
        const total = Number(m[1]), passed = Number(m[2]), failed = Number(m[3]);
        // 自洽兜底：不管哪种格式，passed+failed 必须等于 total。
        return { total: passed + failed === total ? total : passed + failed, passed, failed };
      }
      if (kind === 'pair') {
        const passed = Number(m[1]), failed = Number(m[2]);
        return { total: passed + failed, passed, failed };
      }
      const n = Number(m[1]);
      return { total: n, passed: n, failed: 0 };
    }
  }
  return null;
}