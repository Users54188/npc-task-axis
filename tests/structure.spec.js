/**
 * 工程结构校验：node tests/structure.spec.js
 * 覆盖小程序编译期最容易翻车的几件事：页面文件缺失、require 路径写错、
 * tabBar 指向未注册页面、WXML 里出现非法函数表达式。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
let passed = 0;
const failures = [];
// 收集失败而非首个即抛：本文件全是守文档/守结构的守卫，一处漂移会挡住后面
// 所有守卫，一次跑完才看得出到底漂了几处。
function ok(label, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + label);
  } catch (err) {
    failures.push(label);
    console.log('  ✗ ' + label + '\n      ' + String(err.message).split('\n').join('\n      '));
  }
}

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce(function (acc, e) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return acc.concat(walk(p, ext));
    return p.endsWith(ext) ? acc.concat([p]) : acc;
  }, []);
}

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

console.log('工程结构校验\n');

ok('app.json 声明的每个页面都有 .js / .wxml / .json 三件套', function () {
  appJson.pages.forEach(function (p) {
    ['.js', '.wxml', '.json'].forEach(function (ext) {
      const f = path.join(ROOT, p + ext);
      assert.ok(fs.existsSync(f), '缺少 ' + p + ext);
      assert.ok(fs.statSync(f).size > 0, '空文件 ' + p + ext);
    });
  });
});

ok('tabBar 每一项都指向已注册页面', function () {
  (appJson.tabBar.list || []).forEach(function (t) {
    assert.ok(appJson.pages.indexOf(t.pagePath) >= 0, 'tabBar 页面未注册：' + t.pagePath);
  });
  assert.ok(appJson.tabBar.list.length >= 2 && appJson.tabBar.list.length <= 5, 'tabBar 数量须在 2~5');
});

ok('所有 require 相对路径都能解析到真实文件', function () {
  const bad = [];
  walk(ROOT, '.js').forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /require\(\s*'([^']+)'\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const base = path.resolve(path.dirname(f), spec);
      const hit = [base, base + '.js', path.join(base, 'index.js'), base + '.json'].some(function (c) {
        return fs.existsSync(c) && fs.statSync(c).isFile();
      });
      if (!hit) bad.push(path.relative(ROOT, f) + ' → ' + spec);
    }
  });
  assert.deepStrictEqual(bad, [], '无法解析：\n    ' + bad.join('\n    '));
});

ok('WXML 中不出现 JS 函数表达式（小程序模板不支持）', function () {
  const bad = [];
  walk(ROOT, '.wxml').forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    if (/function\s*\(|=>|\.filter\(|\.map\(|\.join\(/.test(src)) {
      bad.push(path.relative(ROOT, f));
    }
  });
  assert.deepStrictEqual(bad, [], '含非法表达式：' + bad.join(', '));
});

ok('每个 Page 的 bind 事件在对应 js 里都有实现', function () {
  const missing = [];
  appJson.pages.forEach(function (p) {
    const wxml = fs.readFileSync(path.join(ROOT, p + '.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, p + '.js'), 'utf8');
    const re = /(?:bind|catch)(?:tap|input|change|confirm|blur)?="([A-Za-z0-9_]+)"/g;
    let m;
    const seen = {};
    while ((m = re.exec(wxml))) {
      if (seen[m[1]]) continue;
      seen[m[1]] = 1;
      if (!new RegExp('\\b' + m[1] + '\\s*[(:]').test(js)) {
        missing.push(p + ' → ' + m[1]);
      }
    }
  });
  assert.deepStrictEqual(missing, [], '未实现的处理函数：' + missing.join(', '));
});

ok('project.config.json 不泄露真实 AppID', function () {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'project.config.json'), 'utf8'));
  assert.ok(cfg.appid === 'touristappid' || /^[a-z0-9]{15,18}$/.test(cfg.appid), 'appid 形态异常');
  const gi = fs.readFileSync(path.join(ROOT, '..', '.gitignore'), 'utf8');
  assert.ok(/secrets/.test(gi), '.gitignore 未忽略密钥文件');
});

ok('每个云函数都有 index.js + package.json 且声明 wx-server-sdk', function () {
  const dir = path.join(__dirname, '..', 'cloudfunctions');
  assert.ok(fs.existsSync(dir), 'cloudfunctions/ 不存在');
  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter(function (e) { return e.isDirectory(); })
    .map(function (e) { return e.name; });
  assert.ok(names.length >= 3, '云函数数量：' + names.join(', '));
  names.forEach(function (n) {
    assert.ok(fs.existsSync(path.join(dir, n, 'index.js')), n + ' 缺 index.js');
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, n, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies && pkg.dependencies['wx-server-sdk'], n + ' 未声明 wx-server-sdk');
    assert.strictEqual(pkg.main, 'index.js', n + ' main 应为 index.js');
  });
});

ok('仓库内全部 JS 通过语法检查', function () {
  const dirs = [ROOT, path.join(__dirname, '..', 'cloudfunctions'), path.join(__dirname, '..', 'tests')];
  const files = dirs.filter(function (p) { return fs.existsSync(p); }).reduce(function (a, p) {
    return a.concat(walk(p, '.js'));
  }, []);
  assert.ok(files.length >= 15, '扫描到的 JS 文件过少：' + files.length);
  files.forEach(function (f) {
    assert.doesNotThrow(function () {
      new (require('vm').Script)(fs.readFileSync(f, 'utf8'), { filename: f });
    }, '语法错误：' + path.relative(path.join(__dirname, '..'), f));
  });
});

ok('模板用到的每个 class 都在 WXSS 里有定义', function () {
  const appCss = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
  const undefinedClasses = [];
  appJson.pages.forEach(function (p) {
    const wxml = fs.readFileSync(path.join(ROOT, p + '.wxml'), 'utf8');
    const css = appCss + '\n' + fs.readFileSync(path.join(ROOT, p + '.wxss'), 'utf8');
    const declared = new Set();
    css.replace(/\.([A-Za-z][\w-]*)/g, function (_, c) { declared.add(c); return ''; });

    const used = new Set();
    wxml.replace(/class="([^"]*)"/g, function (_, value) {
      // 必须先整体剥掉 {{...}}（里面含空格），否则按空白切分会把表达式切成碎片
      value.replace(/\{\{[\s\S]*?\}\}/g, ' ')
        .split(/\s+/)
        .forEach(function (tok) {
          if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(tok)) return;   // 过滤 c- 这类被截断的残片
          if (/-$/.test(tok)) return;
          used.add(tok);
        });
      return '';
    });
    used.forEach(function (c) {
      if (!declared.has(c)) undefinedClasses.push(p + ' → .' + c);
    });
  });
  assert.deepStrictEqual(undefinedClasses, [], '样式未定义的 class：' + undefinedClasses.join(', '));
});

ok('每个列表页都订阅远端变更且都有退订路径', function () {
  const missing = [];
  appJson.pages.forEach(function (p) {
    const js = fs.readFileSync(path.join(ROOT, p + '.js'), 'utf8');
    if (!/store\.onSync\(/.test(js)) { missing.push(p + ' 未订阅 onSync'); return; }
    if (!/offSync|this\._unsub\(\)/.test(js)) missing.push(p + ' 订阅后没有退订，监听器会随页面堆积');
  });
  assert.deepStrictEqual(missing, [], missing.join('；'));
});

function repoSrcFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce(function (acc, e) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return acc.concat(repoSrcFiles(p));
    return /\.(js|json|wxml|wxss)$/.test(p) && !/package(-lock)?\.json$/.test(p) ? acc.concat([p]) : acc;
  }, []);
}

ok('说明文档自述的规模数字与仓库实际一致', function () {
  const REPO = path.join(__dirname, '..');
  const doc = fs.readFileSync(path.join(REPO, 'docs', 'submission', '说明文档.md'), 'utf8');
  const game = require(path.join(ROOT, 'utils', 'game.js'));
  const kb = require(path.join(ROOT, 'data', 'knowledge-base.json'));
  const cloudFns = fs.readdirSync(path.join(REPO, 'cloudfunctions'), { withFileTypes: true })
    .filter(function (e) { return e.isDirectory(); }).length;
  const srcCount = repoSrcFiles(path.join(REPO, 'miniprogram'))
    .concat(repoSrcFiles(path.join(REPO, 'cloudfunctions'))).length;
  const testFiles = fs.readdirSync(path.join(REPO, 'tests'))
    .filter(function (f) { return f.endsWith('.spec.js'); }).length;

  const scale = doc.match(/(\d+) 个页面、(\d+) 个云函数、(\d+) 个产品源文件（另有 (\d+) 个测试文件）/);
  assert.ok(scale, '说明文档的「代码规模」行必须能被解析，否则改数字时守不住');
  assert.strictEqual(+scale[1], appJson.pages.length, '页面数与 app.json 不符');
  assert.strictEqual(+scale[2], cloudFns, '云函数数与 cloudfunctions/ 目录不符');
  assert.strictEqual(+scale[3], srcCount, '产品源文件数与实际不符');
  assert.strictEqual(+scale[4], testFiles, '测试文件数与实际不符');

  const shell = doc.match(/(\d+) 级等级、(\d+) 章剧情、连续打卡天数、(\d+) 枚徽章/);
  assert.ok(shell, '说明文档的「养成外壳」行必须能被解析');
  assert.strictEqual(+shell[1], game.LEVELS.length, '等级数与 game.js 不符');
  assert.strictEqual(+shell[2], game.CHAPTERS.length, '章节数与 game.js 不符');
  assert.strictEqual(+shell[3], game.BADGES.length, '徽章数与 game.js 不符');

  const kbCount = doc.match(/内置的 (\d+) 个证书\/赛事知识库/);
  assert.ok(kbCount, '说明文档的知识库条数必须能被解析');
  assert.strictEqual(+kbCount[1], kb.entries.length, '知识库条数与 knowledge-base.json 不符');
});

ok('README 的测试分解表与声明的总数自洽', function () {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const decl = readme.match(/npm test\s+#\s*(\d+) 个测试用例全绿\r?\n# (.+)/);
  assert.ok(decl, 'README 必须先声明总数、下一行给出逐文件分解表');
  const parts = decl[2]
    .split('·')
    .map(function (s) { return s.trim().match(/(\d+)$/); })
    .filter(Boolean)
    .map(function (m) { return +m[1]; });
  const specCount = fs.readdirSync(path.join(__dirname, '..') + '/tests')
    .filter(function (f) { return f.endsWith('.spec.js'); }).length;
  assert.strictEqual(parts.length, specCount,
    '分解表必须逐文件列出，条目数应等于 spec 文件数（当前 ' + specCount + '）');
  assert.strictEqual(parts.reduce(function (a, b) { return a + b; }, 0), +decl[1],
    '分解表之和必须等于声明的总数 —— 新增用例后两处要一起改');
});

ok('云函数用到的每个 openapi 都在 config.json 里声明了权限', function () {
  // 官方《云调用》：每个云函数需声明其会使用到的接口，否则无法调用（-604101）。
  const dir = path.join(__dirname, '..', 'cloudfunctions');
  const missing = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    if (!e.isDirectory()) return;
    const fnDir = path.join(dir, e.name);
    const used = new Set();
    walk(fnDir, '.js').forEach(function (f) {
      const src = fs.readFileSync(f, 'utf8');
      [...src.matchAll(/cloud\.openapi\.([a-zA-Z]+\.[a-zA-Z]+)/g)].forEach(function (m) {
        used.add(m[1]);
      });
    });
    if (!used.size) return;
    const cfgPath = path.join(fnDir, 'config.json');
    if (!fs.existsSync(cfgPath)) {
      missing.push(e.name + ' 调用了 ' + [...used].join('/') + ' 但没有 config.json');
      return;
    }
    const declared = (JSON.parse(fs.readFileSync(cfgPath, 'utf8')).permissions || {}).openapi || [];
    [...used].forEach(function (api) {
      if (declared.indexOf(api) < 0) missing.push(e.name + ' 未声明 ' + api);
    });
  });
  assert.deepStrictEqual(missing, [], 'openapi 权限缺失会在真机部署后才暴露：' + missing.join('；'));
});

ok('说明文档的「提交前必须补齐」清单与正文占位一一对应', function () {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'docs', 'submission', '说明文档.md'), 'utf8')
    .split(/\r?\n/);
  const head = lines.filter(function (l) { return /提交前必须补齐/.test(l); })[0];
  assert.ok(head, '必须有一行「提交前必须补齐」清单');
  const named = {};
  [...head.matchAll(/〔([^〕]+)〕/g)].forEach(function (m) { named[m[1]] = 1; });
  const claimed = head.match(/(\d+) 项占位/);
  assert.ok(claimed, '清单必须写明项数');

  const body = lines.filter(function (l) { return !/提交前必须补齐/.test(l); }).join('\n');
  const actual = {};
  [...body.matchAll(/〔([^〕]+)〕/g)].forEach(function (m) { actual[m[1]] = 1; });
  const keys = Object.keys(actual);

  assert.strictEqual(+claimed[1], keys.length,
    '清单声明 ' + claimed[1] + ' 项，正文实际 ' + keys.length + ' 项');
  assert.deepStrictEqual(keys.filter(function (k) { return !named[k]; }), [],
    '这些占位没被清单列出，填清单的人会漏掉：');
  assert.deepStrictEqual(Object.keys(named).filter(function (k) { return !actual[k]; }), [],
    '清单列了正文里不存在的占位：');
});

ok('配置清单每个 status 都有 chip 样式与文案（动态 class 逃得过 class 守卫）', function () {
  const setup = require(path.join(ROOT, 'utils', 'setup.js'));
  const rows = setup.audit().items.concat(setup.audit({ lastSubError: 'x' }).items);
  const statuses = Array.from(new Set(rows.map(function (i) { return i.status; })));
  assert.ok(statuses.length >= 4, '状态种类不该少于已知的 done/pending/cloud/blocked');
  const dir = path.join(ROOT, 'pages', 'mine');
  const wxss = fs.readFileSync(path.join(dir, 'mine.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(dir, 'mine.wxml'), 'utf8');
  const noStyle = statuses.filter(function (s) { return wxss.indexOf('.s-' + s) < 0; });
  const noText = statuses.filter(function (s) { return wxml.indexOf("'" + s + "'") < 0; });
  assert.deepStrictEqual(noStyle, [], '这些 status 没有对应 chip 样式：' + noStyle.join('、'));
  assert.deepStrictEqual(noText, [], '这些 status 在模板里没有对应文案，会掉进兜底显示：' + noText.join('、'));
});

console.log('\n' + passed + ' / ' + (passed + failures.length) + ' 通过');
if (failures.length) {
  console.log(failures.length + ' 个守卫被违反：\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
