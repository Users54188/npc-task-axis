/**
 * 上线配置自检清单验证：node tests/setup.spec.js
 * 「还差哪几项」这件事必须是被测过的，而不是靠人肉读注释。
 */
const assert = require('assert');
const setup = require('../miniprogram/utils/setup');
const config = require('../miniprogram/utils/config');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

function byKey(items) {
  return items.reduce(function (m, i) { m[i.key] = i; return m; }, {});
}

console.log('配置自检清单\n');

const fresh = setup.audit();

ok('默认状态下如实报出两项本地待填', function () {
  assert.strictEqual(fresh.pending, 2, JSON.stringify(fresh.items.map(function (i) { return i.key + ':' + i.status; })));
  assert.strictEqual(fresh.ready, false);
  const m = byKey(fresh.items);
  assert.strictEqual(m.CLOUD_ENV.status, 'pending');
  assert.strictEqual(m.SUBSCRIBE_TMPL_IDS.status, 'pending');
});

ok('云端项标为 cloud 而不是假装已配置或未配置', function () {
  const m = byKey(fresh.items);
  assert.strictEqual(m.REMIND_CONFIG.status, 'cloud');
  assert.strictEqual(m.dailyRemind.status, 'cloud');
  assert.strictEqual(fresh.cloud, 2);
});

ok('识别功能标为 blocked 且不计入必填', function () {
  const m = byKey(fresh.items);
  assert.strictEqual(m.RECOGNIZE.status, 'blocked');
  assert.strictEqual(m.RECOGNIZE.required, false);
  assert.strictEqual(fresh.blocked, 1);
});

ok('填齐后 ready 为真，摘要转向云端核对', function () {
  const done = setup.audit({ CLOUD_ENV: 'env-test', SUBSCRIBE_TMPL_IDS: ['tpl-1'] });
  assert.strictEqual(done.pending, 0);
  assert.strictEqual(done.ready, true);
  assert.ok(/云控制台/.test(done.summary), done.summary);
  assert.ok(done.summary.indexOf('2 项') >= 0, done.summary);
});

ok('只填一半仍算未就绪', function () {
  assert.strictEqual(setup.audit({ CLOUD_ENV: 'env-test' }).ready, false);
  assert.strictEqual(setup.audit({ SUBSCRIBE_TMPL_IDS: ['a'] }).ready, false);
  assert.strictEqual(setup.audit({ SUBSCRIBE_TMPL_IDS: [] }).ready, false);
});

ok('每一项都给出位置、原因和操作方式，不能只说"未配置"', function () {
  fresh.items.forEach(function (i) {
    assert.ok(i.label && i.label.length > 1, i.key + ' 缺 label');
    assert.ok(i.where && i.where.length > 3, i.key + ' 缺 where');
    assert.ok(i.why && i.why.length > 6, i.key + ' 缺 why');
    assert.ok(i.how && i.how.length > 6, i.key + ' 缺 how');
    assert.ok(['done', 'pending', 'cloud', 'blocked'].indexOf(i.status) >= 0, i.key + ' 状态非法：' + i.status);
  });
});

ok('audit 不修改真实 config', function () {
  const before = JSON.stringify({ e: config.CLOUD_ENV, s: config.SUBSCRIBE_TMPL_IDS, r: config.RECOGNIZE_ENABLED });
  setup.audit({ CLOUD_ENV: 'fake', SUBSCRIBE_TMPL_IDS: ['fake'], RECOGNIZE_ENABLED: true });
  assert.strictEqual(JSON.stringify({ e: config.CLOUD_ENV, s: config.SUBSCRIBE_TMPL_IDS, r: config.RECOGNIZE_ENABLED }), before);
  assert.strictEqual(config.CLOUD_ENV, '', '真实配置必须保持原样');
});

ok('重复调用结果稳定（清单可进快照测试）', function () {
  assert.deepStrictEqual(setup.audit(), setup.audit());
  assert.deepStrictEqual(setup.audit({ CLOUD_ENV: 'x' }), setup.audit({ CLOUD_ENV: 'x' }));
});

ok('清单条目不重复', function () {
  const keys = fresh.items.map(function (i) { return i.key; });
  assert.strictEqual(new Set(keys).size, keys.length, keys.join(','));
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
