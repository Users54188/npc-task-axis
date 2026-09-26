/**
 * 生成「知识库人工核对表」：把 10 条考证/赛事条目按小程序**实际会回填的日期**
 * 打印成一张待填清单，供人工对照当年官方公告逐条核。
 *
 * 为什么要生成而不是手写：手写清单会和 knowledge-base.json 脱节。这里直接调
 * utils/kb.js 的 suggest()，输出就是用户在「接新任务」时看到的那组日期，
 * 核的就是真正生效的数据。
 *
 * 用法：npm run review   →  output/submission/知识库核对表.md
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const kb = require(path.join(ROOT, 'miniprogram', 'utils', 'kb.js'));
const d = require(path.join(ROOT, 'miniprogram', 'utils', 'date.js'));
const data = require(path.join(ROOT, 'miniprogram', 'data', 'knowledge-base.json'));
const OUT = path.join(ROOT, 'output', 'submission', '知识库核对表.md');

function dash(v) { return v || '—'; }

function checkedOfficially(entry) { return /^(已核|已按)/.test(entry.verify || ''); }

function row(entry) {
  const hit = kb.suggest(entry.name, d.parse(kb.todayStr())) || {};
  return [
    '| ' + (checkedOfficially(entry) ? '已核官方' : '**待核**') + ' | '
      + entry.shortName + ' | ' + entry.name + ' | ' + dash(hit.regStart) + ' ~ ' + dash(hit.regEnd) +
      ' | ' + dash(hit.admitStart) + ' ~ ' + dash(hit.admitEnd) +
      ' | ' + dash(hit.examDate) +
      ' | ' + dash(hit.scoreStart) + ' ~ ' + dash(hit.scoreEnd) +
      ' | ' + dash(entry.fee) + ' | ' + dash(entry.place) + ' | ' + entry.site +
      ' | ' + entry.verify + ' | ☐ |'
  ].join('');
}

const lines = [];
lines.push('# 内置知识库人工核对表');
lines.push('');
lines.push('> 生成时间：' + new Date().toISOString().slice(0, 10) +
  ' 参考日期：' + kb.todayStr() + '（所有日期就是小程序此刻会回填的值）');
lines.push('> 知识库版本：' + kb.version);
lines.push('');
lines.push('**为什么必须核**：这 10 条的考期、报名窗口、费用、官网是**由大语言模型检索归纳**出来的，' +
  '程序只验过内部一致性（日期单调、窗口与考期匹配），**没有对照当年官方公告逐条终审**。' +
  '报错一个报名窗口，用户就可能错过一次考试。');
lines.push('');
lines.push('核对方法：打开「官网」列的链接，找当年公告，比对下面四个日期与费用；' +
  '不一致就改 `miniprogram/data/knowledge-base.json` 对应条目，然后 `npm test` 确认仍然全绿。');
lines.push('');
lines.push('| 状态 | 简称 | 名称 | 报名 | 准考证 | 考试 | 查分 | 费用 | 考点 | 官网 | 必须核对的点 | 已核 |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
// 待核的排前面：这张表的用途是驱动剩下的核对，不是展示已完成的部分。
data.entries.slice().sort(function (a, b) {
  return (checkedOfficially(a) ? 1 : 0) - (checkedOfficially(b) ? 1 : 0);
}).forEach(function (e) { lines.push(row(e)); });
const n = data.entries.filter(checkedOfficially).length;
lines.push('');
lines.push('已对照官方公告核过 ' + n + ' 条，**待核 ' + (data.entries.length - n) + ' 条**。');
lines.push('每核完一条，就把该条 `verify` 改成以「已核」或「已按」开头并写明官方日期与来源，' +
  '再跑 `npm test` —— `structure.spec` 会核对说明文档里「公告核过 N 条」这个数字与库内实际是否一致。');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log('已生成 ' + OUT + '  （' + data.entries.length + ' 条）');
