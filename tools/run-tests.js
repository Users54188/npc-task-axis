/**
 * 顺序跑完全部 tests/*.spec.js，汇总每个文件的用例数与总数。
 * 必须串行：page 类测试会覆写全局 `wx`，并行会互相踩存储。
 * 用法：node tools/run-tests.js   或   npm test
 *
 * README 与 docs/submission/说明文档.md 里的「N 个测试用例」以此处的总计为准，
 * 改完测试就重跑一次，把总计和分解行原样抄过去。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(TESTS).filter(function (f) { return f.endsWith('.spec.js'); }).sort();

// 各 spec 的收尾行格式不完全一致，两种都要认。
const LINE = /(\d+)\s*(?:\/\s*\d+\s*)?通过(?:\s*\/\s*(\d+)\s*失败)?/;

const rows = [];
let failed = 0;
files.forEach(function (f) {
  const r = spawnSync(process.execPath, [path.join(TESTS, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(LINE);
  const n = m ? +m[1] : 0;
  const bad = m && m[2] ? +m[2] : 0;
  if (r.status !== 0 || bad > 0 || !m) {
    failed++;
    console.log('✗ ' + f + (m ? '（' + bad + ' 失败）' : '（未打印汇总行）'));
    console.log(out.split(/\r?\n/).slice(-24).join('\n'));
  } else {
    console.log('✓ ' + f + '  ' + n + ' 例');
  }
  rows.push({ file: f.replace('.spec.js', ''), count: n });
});

const total = rows.reduce(function (a, r) { return a + r.count; }, 0);
console.log('\n总计：' + rows.length + ' 个测试文件，' + total + ' 个测试用例');
console.log('# ' + rows.map(function (r) { return r.file + ' ' + r.count; }).join(' · '));
process.exit(failed ? 1 : 0);
