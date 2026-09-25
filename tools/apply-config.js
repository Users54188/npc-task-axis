/**
 * 把后台拿到的三个值一次性填到位，并校验它们互相自洽。
 *
 * 为什么需要：CLOUD_ENV / SUBSCRIBE_TMPL_IDS 在 config.js，AppID 在
 * project.config.json，REMIND_CONFIG 在云函数环境变量 —— 四处必须一致，手抄最
 * 容易出的错是「客户端申请了 A 模板的额度、服务端却按 B 模板发」，而这种错只
 * 会在真机到点不发提醒时才被发现。
 *
 * 用法：
 *   node tools/apply-config.js --appid=wx1234... --env=my-env-2g9x \
 *        --tmpl=ID1,ID2 --remind=@remind.json [--dry-run]
 *
 * REMIND_CONFIG 写不进云控制台，脚本只校验并把该粘的 JSON 打印出来。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_JS = path.join(ROOT, 'miniprogram', 'utils', 'config.js');
const PROJECT_JSON = path.join(ROOT, 'project.config.json');
const KINDS = ['reg', 'admit', 'exam', 'score'];

function parseArgs(argv) {
  const out = { dryRun: false };
  argv.forEach(function (a) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) return;
    if (m[1] === 'dry-run') out.dryRun = true;
    else out[m[1]] = m[2] === undefined ? 'true' : m[2];
  });
  return out;
}

/**
 * 校验并返回错误列表；空数组表示可以写。
 * 纯函数，不碰文件系统，方便被测。
 */
function check(input) {
  const errs = [];
  const appid = (input.appid || '').trim();
  const env = (input.env || '').trim();
  const tmpl = (input.tmpl || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

  if (!/^wx[0-9a-zA-Z]{15,}$/.test(appid)) {
    errs.push('AppID 形如 wx 开头共 18 位，收到：' + (appid || '(空)'));
  }
  if (!env) errs.push('CLOUD_ENV 不能为空（云开发控制台 → 环境 ID）');
  else if (/\s/.test(env)) errs.push('CLOUD_ENV 不能含空格：' + env);

  if (!tmpl.length) errs.push('SUBSCRIBE_TMPL_IDS 不能为空，否则到点无消息可发');
  if (tmpl.some(function (t) { return !/^[A-Za-z0-9_-]{10,}$/.test(t); })) {
    errs.push('模板 ID 看起来不像（应为 10 位以上字母数字下划线连字符）：' + tmpl.join(' '));
  }

  let remind = input.remind;
  if (typeof remind === 'string' && remind[0] === '@') {
    try { remind = fs.readFileSync(path.resolve(ROOT, remind.slice(1)), 'utf8'); }
    catch (e) { errs.push('读不到 --remind 指向的文件：' + remind); remind = null; }
  }
  if (typeof remind === 'string') {
    try { remind = JSON.parse(remind); }
    catch (e) { errs.push('REMIND_CONFIG 不是合法 JSON：' + e.message); remind = null; }
  }

  if (remind && typeof remind === 'object') {
    const keys = Object.keys(remind);
    const unknown = keys.filter(function (k) { return KINDS.indexOf(k) < 0; });
    if (unknown.length) errs.push('REMIND_CONFIG 有未知种类：' + unknown.join(' ') + '（只认 ' + KINDS.join('/') + '）');
    if (!keys.length) errs.push('REMIND_CONFIG 是空对象，等于没配');
    keys.forEach(function (k) {
      const v = remind[k] || {};
      if (!v.templateId) errs.push('REMIND_CONFIG.' + k + ' 缺 templateId');
      else if (tmpl.indexOf(v.templateId) < 0) {
        errs.push('REMIND_CONFIG.' + k + '.templateId 不在 SUBSCRIBE_TMPL_IDS 里 —— 客户端不会申请它的额度，必然发不出');
      }
      if (!v.fields || !Object.keys(v.fields).length) errs.push('REMIND_CONFIG.' + k + ' 缺 fields 映射');
    });
  } else if (remind === undefined || remind === null) {
    errs.push('还缺 --remind（REMIND_CONFIG JSON 或 @文件），没有它提醒发不出去');
  }

  return errs;
}

/**
 * 纯函数：在字符串里把 anchor 换成 value。锚点必须自带结尾（不含逗号），
 * 替换值也不再加逗号 —— 之前多加的那个逗号会让 config.js 变成 `,,` 直接语法错。
 * 用函数做替换，避免值里的 $& / $1 被当成反向引用。
 */
function substitute(src, re, value, label) {
  if (!re.test(src)) throw new Error('找不到锚点 ' + label + '，请手动改');
  const lit = JSON.stringify(value);
  return src.replace(re, function () { return lit; });
}

function replaceIn(file, re, value, label) {
  fs.writeFileSync(file, substitute(fs.readFileSync(file, 'utf8'), re, value, label));
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const errs = check(a);
  if (errs.length) {
    console.log('没有写入任何文件。以下问题要先解决：');
    errs.forEach(function (e) { console.log('  ✗ ' + e); });
    process.exit(1);
  }

  const tmpl = a.tmpl.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  console.log('校验通过：AppID=' + a.appid + '  环境=' + a.env + '  模板 ' + tmpl.length + ' 个');

  if (a.dryRun) { console.log('--dry-run，未写文件。'); return; }

  // 锚点用后顾断言只圈住「值」本身：整段匹配会把键名一起替换掉。
  replaceIn(CONFIG_JS, /(?<=CLOUD_ENV: *)''/, a.env, 'CLOUD_ENV');
  replaceIn(CONFIG_JS, /(?<=SUBSCRIBE_TMPL_IDS: *)\[\]/, tmpl, 'SUBSCRIBE_TMPL_IDS');
  replaceIn(PROJECT_JSON, /(?<="appid": *)"touristappid"/, a.appid, 'appid');

  console.log('已写：miniprogram/utils/config.js、project.config.json');
  console.log('\n还要你手动做一步 —— 云开发控制台 → 云函数 remind → 环境变量：');
  console.log('  REMIND_CONFIG = ' + a.remind);
  console.log('\n然后 npm test 确认没改坏，再用微信开发者工具上传代码。');
}

if (require.main === module) main();
module.exports = { check, parseArgs, substitute };
