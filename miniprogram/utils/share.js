/**
 * 任务轴长图：把时间轴排成一张可分享的图片。
 *
 * 分两步：buildModel 负责「画什么」（纯数据），layout 负责「画在哪」（纯几何）。
 * 两者都不碰 wx API，因此绘制内容可以在 Node 侧逐条断言，
 * 页面里只保留 ctx 执行与保存相册这一段无法自动化的部分。
 */
const d = require('./date');
const axis = require('./axis');

const W = 750;
const PAD = 48;
const ROW_H = 92;
const HEAD_H = 200;
const FOOT_H = 96;
const MAX_ROWS = 12;

const STATE_COLOR = {
  active: { bg: '#FFECEE', fg: '#F2555A', dot: '#F2555A' },
  future: { bg: '#FFFFFF', fg: '#1C1B22', dot: '#C9C6D6' },
  past: { bg: '#FFFFFF', fg: '#B5B3BE', dot: '#22B573' }
};

const KIND_LABEL = { reg: '报名', admit: '准考证', exam: '考试', score: '查分' };

function clamp(s, n) {
  const v = String(s === undefined || s === null ? '' : s);
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
}

/** 生成绘制模型：标题、副标题、按时间排序的节点行、页脚 */
function buildModel(tasks, checks, stats, today) {
  const ref = d.parse(today) || new Date();
  const nodes = axis.buildAxis(tasks || [], today)
    .filter(function (n) { return n.state !== 'past'; })
    .slice(0, MAX_ROWS);

  return {
    width: W,
    title: '大学 NPC 任务轴',
    subtitle: d.fmt(ref) + ' · ' + ((tasks || []).length) + ' 个任务 · 连续 ' +
      ((stats && stats.streak) || 0) + ' 天 · Lv.' + ((stats && stats.level && stats.level.lv) || 1),
    rows: nodes.map(function (n) {
      return {
        key: n.id,
        date: n.dateText,
        name: clamp(n.taskName, 14),
        kind: KIND_LABEL[n.kind] || n.label,
        note: n.state === 'active' ? '进行中' : '剩 ' + n.days + ' 天',
        state: n.state,
        hot: !!n.hot
      };
    }),
    footer: '报名 · 准考证 · 考试 · 查分，一个节点都不漏',
    height: HEAD_H + Math.max(1, nodes.length) * ROW_H + FOOT_H
  };
}

/** 空任务时也要出一张有意义的图，而不是空白 */
function emptyModel(today) {
  const ref = d.parse(today) || new Date();
  return {
    width: W,
    title: '大学 NPC 任务轴',
    subtitle: d.fmt(ref) + ' · 还没有任务',
    rows: [{ key: 'empty', date: '', name: '去接第一个任务吧', kind: '', note: '', state: 'future', hot: false }],
    footer: '报名 · 准考证 · 考试 · 查分，一个节点都不漏',
    height: HEAD_H + ROW_H + FOOT_H
  };
}

/** 模型 → 绘制指令序列，供 canvas 逐条执行 */
function layout(model) {
  const ops = [];
  ops.push({ op: 'rect', x: 0, y: 0, w: model.width, h: model.height, fill: '#F4F5F8' });
  ops.push({ op: 'gradRect', x: 0, y: 0, w: model.width, h: HEAD_H, from: '#6C4BE8', to: '#8E6BFF' });
  ops.push({ op: 'text', x: PAD, y: 92, text: model.title, size: 40, weight: 'bold', color: '#FFFFFF' });
  ops.push({ op: 'text', x: PAD, y: 140, text: model.subtitle, size: 22, color: 'rgba(255,255,255,.88)' });

  model.rows.forEach(function (r, i) {
    const y = HEAD_H + i * ROW_H;
    const c = STATE_COLOR[r.state] || STATE_COLOR.future;
    if (r.hot) ops.push({ op: 'rrect', x: PAD - 12, y: y + 8, w: model.width - PAD * 2 + 24, h: ROW_H - 16, r: 14, fill: c.bg });
    else ops.push({ op: 'rrect', x: PAD - 12, y: y + 8, w: model.width - PAD * 2 + 24, h: ROW_H - 16, r: 14, fill: '#FFFFFF' });

    ops.push({ op: 'circle', cx: PAD + 8, cy: y + ROW_H / 2, r: 7, fill: c.dot });
    ops.push({ op: 'text', x: PAD + 30, y: y + 38, text: r.date, size: 20, color: '#9A98A3' });
    ops.push({ op: 'text', x: PAD + 30, y: y + 70, text: r.name, size: 26, weight: 'bold', color: c.fg });
    if (r.kind) ops.push({ op: 'tag', x: model.width - PAD - 150, y: y + 34, text: r.kind, size: 20, color: c.fg });
    if (r.note) ops.push({ op: 'text', x: model.width - PAD - 150, y: y + 70, text: r.note, size: 20, color: '#9A98A3', align: 'left' });
  });

  const fy = model.height - FOOT_H + 40;
  ops.push({ op: 'line', x1: PAD, y1: model.height - FOOT_H, x2: model.width - PAD, y2: model.height - FOOT_H, color: '#ECEBF1' });
  ops.push({ op: 'text', x: PAD, y: fy + 20, text: model.footer, size: 22, color: '#6B6A75' });
  return ops;
}

/**
 * 在 canvas 2d 上下文上执行指令。
 * 用标准 2D API（fillStyle / font / textAlign），因为页面用的是 <canvas type="2d">；
 * 旧的 setFillStyle 系列只对已废弃的 canvas-id 组件有效，混用会运行时报错。
 */
function draw(ctx, model) {
  layout(model).forEach(function (o) {
    switch (o.op) {
      case 'rect':
        ctx.fillStyle = o.fill;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        break;
      case 'rrect':
        ctx.fillStyle = o.fill;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(o.x, o.y, o.w, o.h, o.r);
        else ctx.rect(o.x, o.y, o.w, o.h);
        ctx.fill();
        break;
      case 'gradRect': {
        const g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
        g.addColorStop(0, o.from);
        g.addColorStop(1, o.to);
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        break;
      }
      case 'circle':
        ctx.fillStyle = o.fill;
        ctx.beginPath();
        ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'line':
        ctx.strokeStyle = o.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        ctx.stroke();
        break;
      case 'tag':
      case 'text':
      default:
        ctx.fillStyle = o.color;
        ctx.font = (o.weight === 'bold' ? 'bold ' : '') + o.size + 'px sans-serif';
        ctx.textAlign = o.align || 'left';
        ctx.fillText(o.text, o.x, o.y);
    }
  });
  return true;
}

module.exports = { buildModel, emptyModel, layout, draw, clamp, W, HEAD_H, ROW_H, FOOT_H, MAX_ROWS };
