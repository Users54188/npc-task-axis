/**
 * 把 docs/submission/说明文档.md 转成打印就绪的 HTML，
 * 再用无头 Chrome 导出 PDF —— 赛事要求提交「说明文档 PDF」。
 *
 *   node tools/build-pdf.js            # 生成 output/submission/说明文档.html + .pdf
 *
 * Markdown 子集覆盖：标题、表格、有序/无序列表、引用、分隔线、
 * 粗体、行内代码、代码块。只读不改源文件，避免两处真相。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'submission', '说明文档.md');
const OUT_DIR = path.join(ROOT, 'output', 'submission');
const HTML = path.join(OUT_DIR, '说明文档.html');
const PDF = path.join(OUT_DIR, '说明文档.pdf');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(function (p) { return fs.existsSync(p); });

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
}

function isSep(line) {
  return /^\|?[\s:|-]+\|?$/.test(line) && line.indexOf('-') >= 0;
}

function render(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre>' + esc(buf.join('\n')) + '</pre>');
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push('<ul>' + buf.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol>' + buf.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>');
      continue;
    }
    if (line.trim().indexOf('|') === 0 && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().indexOf('|') === 0) { rows.push(splitRow(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>');
      continue;
    }

    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#|>|```|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
    else i++;
  }
  return out.join('\n');
}

const CSS = [
  '@page { size: A4; margin: 18mm 16mm; }',
  'body{font:10.5pt/1.7 "Microsoft YaHei","PingFang SC",sans-serif;color:#1c1b22;margin:0}',
  'h1{font-size:19pt;border-bottom:2px solid #6c4be8;padding-bottom:6pt;margin:0 0 4pt}',
  'h2{font-size:13.5pt;color:#6c4be8;margin:18pt 0 6pt;border-left:4px solid #6c4be8;padding-left:7pt}',
  'h3{font-size:11.5pt;margin:12pt 0 4pt}',
  'p{margin:5pt 0}',
  'table{border-collapse:collapse;width:100%;margin:7pt 0;font-size:9.5pt}',
  'th,td{border:1px solid #d8d6e0;padding:5pt 7pt;text-align:left;vertical-align:top}',
  'th{background:#efebff;color:#3f2ba8}',
  'tr:nth-child(even) td{background:#fafafd}',
  'code{background:#f1f0f6;padding:1pt 4pt;border-radius:3pt;font:9pt Consolas,monospace}',
  'pre{background:#f6f5fa;border:1px solid #e5e3ee;border-radius:5pt;padding:8pt 10pt;font:8.8pt Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
  'blockquote{margin:7pt 0;padding:6pt 10pt;background:#fff8e6;border-left:4px solid #f5b93f;color:#5a4a20}',
  'ul,ol{margin:5pt 0 5pt 18pt}li{margin:2pt 0}',
  'hr{border:0;border-top:1px solid #e5e3ee;margin:12pt 0}',
  '.ph{background:#ffecee;color:#a11a20;padding:0 3pt;border-radius:3pt;font-weight:700}',
  '.foot{margin-top:16pt;padding-top:7pt;border-top:1px solid #e5e3ee;font-size:8.5pt;color:#8a8894}',
  'h2{break-after:avoid}table,pre,blockquote{break-inside:avoid}'
].join('\n');

if (!CHROME) { console.error('FAIL  未找到 Chrome / Edge'); process.exit(1); }

/**
 * 测试用例总数由 npm test 现场算出，绝不在文档里写死：每加一个用例，手写数字就
 * 过期一次，而 README 那条守卫只查「分解表之和 == 声明总数」这种内部自洽，
 * 202 配旧的分解项照样全绿 —— 已经放走过两轮。跑不动就不出 PDF，不发猜的数字。
 */
function liveTestTotal() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'run-tests.js')], { encoding: 'utf8' });
  const m = ((r.stdout || '') + (r.stderr || '')).match(/总计：(\d+) 个测试文件，(\d+) 个测试用例/);
  if (r.status !== 0 || !m) {
    console.error('FAIL  npm test 未通过或没打印总计（退出码 ' + r.status + '），拒绝生成带猜测数字的 PDF');
    process.exit(1);
  }
  return +m[2];
}

const cases = liveTestTotal();
const md = fs.readFileSync(SRC, 'utf8').replace(/\{\{测试用例数\}\}/g, String(cases));
let htmlBody = render(md);

// 「提交前必须补齐」那行只是清单，本身不算待填项；按字段名去重才是真正要填几项。
const found = md.split(/\r?\n/).filter(function (l) {
  return !/提交前必须补齐/.test(l);
}).join('\n').match(/〔[^〕]*〕/g) || [];
const placeholders = Array.from(new Set(found));
htmlBody = htmlBody.replace(/〔([^〕]*)〕/g, '<span class="ph">〔$1〕</span>');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(HTML, '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
  '<title>大学 NPC 任务轴 · 说明文档</title><style>' + CSS + '</style></head><body>' +
  htmlBody +
  '<div class="foot">本 PDF 由 tools/build-pdf.js 从 docs/submission/说明文档.md 自动生成，' +
  '修改请改源文件后重新生成。生成时间 ' + new Date().toISOString().slice(0, 10) + '。' +
  '红色标记为待填占位，共 ' + placeholders.length + ' 项待填。</div></body></html>');

console.log('HTML  ' + HTML);
console.log('占位待填 ' + placeholders.length + ' 项（正文出现 ' + found.length + ' 处）：');
placeholders.forEach(function (p) { console.log('  - ' + p); });

const r = spawnSync(CHROME, [
  '--headless=new', '--no-first-run', '--disable-gpu',
  '--no-pdf-header-footer',
  '--print-to-pdf=' + PDF,
  'file:///' + HTML.replace(/\\/g, '/')
], { encoding: 'utf8', timeout: 120000 });

if (!fs.existsSync(PDF)) {
  console.error('FAIL  PDF 未生成');
  console.error(String(r.stderr || '').slice(0, 400));
  process.exit(1);
}
console.log('PDF   ' + PDF + '  ' + fs.statSync(PDF).size + ' 字节');
