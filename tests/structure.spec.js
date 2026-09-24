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
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

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

console.log('\n' + passed + ' / ' + passed + ' 通过');
