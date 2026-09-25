/**
 * 配置填写工具的校验逻辑：node tests/applyconfig.spec.js
 * 这个工具存在的意义就是拦住「四处配置互相对不上」，所以它的判断本身必须被测过。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { check, parseArgs, substitute } = require('../tools/apply-config');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

const T1 = 'AbCdEf1234567890xyz';
const T2 = 'ZyXwVu9876543210abc';
const GOOD = {
  appid: 'wx' + '0123456789abcdef',
  env: 'npc-prod-2g9x',
  tmpl: T1 + ',' + T2,
  remind: JSON.stringify({
    reg: { templateId: T1, fields: { thing1: 'thing5' } },
    exam: { templateId: T2, fields: { date2: 'date9' } }
  })
};

function only(input) { return check(input); }

console.log('配置填写校验\n');

ok('四个值自洽时放行', function () {
  assert.deepStrictEqual(only(GOOD), []);
});

ok('缺任何一个都被拦下，且不会假装通过', function () {
  ['appid', 'env', 'tmpl', 'remind'].forEach(function (k) {
    const missing = Object.assign({}, GOOD);
    delete missing[k];
    assert.ok(only(missing).length > 0, '缺 ' + k + ' 应该报错');
  });
});

ok('AppID 不像 AppID 时拒绝（防止把 token 或 Secret 粘进来）', function () {
  assert.ok(only(Object.assign({}, GOOD, { appid: 'gh_1a2b3c4d5e6f' })).length > 0, '公众号账号不该过');
  assert.ok(only(Object.assign({}, GOOD, { appid: 'wx123' })).length > 0, '过短不该过');
  assert.ok(only(Object.assign({}, GOOD, { appid: 'wx' + 'a'.repeat(16) })).length === 0, '18 位应过');
});

ok('核心防线：客户端模板与服务端 templateId 不一致必须报错', function () {
  const mismatch = Object.assign({}, GOOD, {
    remind: JSON.stringify({ reg: { templateId: 'OTHERTEMPLATEID123456', fields: { thing1: 'thing5' } } })
  });
  const errs = only(mismatch);
  assert.ok(errs.length > 0, '不该放行');
  assert.ok(errs.some(function (e) { return /不在 SUBSCRIBE_TMPL_IDS/.test(e); }),
    '要给出可执行的解释：' + errs.join(' | '));
});

ok('REMIND_CONFIG 里出现未知种类要拒绝（拼错 kind 会静默不发）', function () {
  const bad = Object.assign({}, GOOD, {
    remind: JSON.stringify({ regis: { templateId: T1, fields: { a: 'b' } } })
  });
  assert.ok(only(bad).some(function (e) { return /未知种类/.test(e); }));
});

ok('缺 fields 映射要拒绝（buildData 会返回 null，等于什么都没发）', function () {
  const bad = Object.assign({}, GOOD, {
    remind: JSON.stringify({ reg: { templateId: T1 } })
  });
  assert.ok(only(bad).some(function (e) { return /fields/.test(e); }));
});

ok('REMIND_CONFIG 非法 JSON 时给可读错误而不是抛栈', function () {
  const errs = only(Object.assign({}, GOOD, { remind: '{reg:' }));
  assert.ok(errs.some(function (e) { return /不是合法 JSON/.test(e); }), errs.join('|'));
});

ok('命令行解析：--dry-run 与带等号的值都对', function () {
  const a = parseArgs(['--appid=wx0123456789abcdef', '--env=e', '--dry-run']);
  assert.strictEqual(a.appid, 'wx0123456789abcdef');
  assert.strictEqual(a.env, 'e');
  assert.strictEqual(a.dryRun, true);
});

ok('写入锚点仍在源文件里（改了 config.js 结构就要同步这个工具）', function () {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'utils', 'config.js'), 'utf8');
  const proj = fs.readFileSync(path.join(__dirname, '..', 'project.config.json'), 'utf8');
  assert.ok(/CLOUD_ENV: *''/.test(cfg), 'config.js 的 CLOUD_ENV 锚点变了');
  assert.ok(/SUBSCRIBE_TMPL_IDS: *\[\]/.test(cfg), 'config.js 的 SUBSCRIBE_TMPL_IDS 锚点变了');
  assert.ok(/"appid": *"touristappid"/.test(proj), 'project.config.json 的 appid 锚点变了');
});

ok('替换后的文件仍然可解析（防住多加逗号这类要真跑才发现的错）', function () {
  const dir = path.join(__dirname, '..');
  const cfg = fs.readFileSync(path.join(dir, 'miniprogram', 'utils', 'config.js'), 'utf8');
  let out = substitute(cfg, /(?<=CLOUD_ENV: *)''/, 'npc-prod-2g9x', 'CLOUD_ENV');
  out = substitute(out, /(?<=SUBSCRIBE_TMPL_IDS: *)\[\]/, [T1, T2], 'SUBSCRIBE_TMPL_IDS');
  assert.ok(!/,,/.test(out), 'config.js 里出现了双逗号');
  assert.ok(/CLOUD_ENV: *"npc-prod-2g9x",/.test(out), '键名必须还在，只换值');
  assert.ok(/SUBSCRIBE_TMPL_IDS: \["/.test(out), '键名必须还在，只换值');

  // 落到临时文件再用正常 require 读回：比 new Function 编译字符串更接近工具的真实效果。
  const tmp = path.join(require('os').tmpdir(), 'npc-cfg-' + Date.now() + '.js');
  fs.writeFileSync(tmp, out);
  try {
    const loaded = require(tmp);
    assert.strictEqual(loaded.CLOUD_ENV, 'npc-prod-2g9x');
    assert.deepStrictEqual(loaded.SUBSCRIBE_TMPL_IDS, [T1, T2]);
    assert.strictEqual(loaded.REMIND_ENV_KEY, 'REMIND_CONFIG', '不该顺手改掉其它配置');
    assert.strictEqual(loaded.RECOGNIZE_ENABLED, false, '不该顺手改掉其它配置');
  } finally {
    fs.unlinkSync(tmp);
  }

  const proj = fs.readFileSync(path.join(dir, 'project.config.json'), 'utf8');
  const p2 = substitute(proj, /(?<="appid": *)"touristappid"/, 'wx0123456789abcdef', 'appid');
  assert.strictEqual(JSON.parse(p2).appid, 'wx0123456789abcdef');
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
