/**
 * 游戏化规则：经验、等级、章节、连续天数、徽章。
 * 全部为本地确定性计算，不依赖任何生成式能力。
 */
const d = require('./date');

const EXP = { checkIn: 5, focus: 10, taskDone: 20, registered: 15 };

const LEVELS = [
  { lv: 1, name: '觉醒的新生', need: 0 },
  { lv: 2, name: '冒险者', need: 65 },
  { lv: 3, name: '见习备考人', need: 180 },
  { lv: 4, name: '副本清道夫', need: 400 },
  { lv: 5, name: '连击大师', need: 750 },
  { lv: 6, name: '双子试炼者', need: 1200 },
  { lv: 7, name: '毕业党', need: 2000 }
];

const CHAPTERS = [
  '一章 · 觉醒的新生', '二章 · 点亮地图', '三章 · 副本初探',
  '四章 · 连击加持', '五章 · 双子试炼', '六章 · 毕业之路', '终章 · 传说'
];

const BADGES = [
  { key: 'first', name: '开箱人', icon: '📖', test: function (s) { return s.checkIns >= 1; } },
  { key: 'three', name: '三日之约', icon: '🔥', test: function (s) { return s.streak >= 3; } },
  { key: 'seven', name: '七日不辍', icon: '⚡', test: function (s) { return s.streak >= 7; } },
  { key: 'focus10', name: '专注新手', icon: '🍅', test: function (s) { return s.focusCount >= 10; } },
  { key: 'multi', name: '多线作战', icon: '🗺', test: function (s) { return s.registered >= 3; } },
  { key: 'score', name: '守到出分', icon: '🏅', test: function (s) { return s.tasksWithScore >= 1; } }
];

function levelOf(exp) {
  let cur = LEVELS[0];
  for (let i = 0; i < LEVELS.length; i++) {
    if (exp >= LEVELS[i].need) cur = LEVELS[i];
  }
  const next = LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(cur) + 1)];
  const span = next.need - cur.need || 1;
  return {
    lv: cur.lv,
    name: cur.name,
    chapter: CHAPTERS[Math.min(CHAPTERS.length - 1, cur.lv - 1)],
    exp: exp,
    need: next.need,
    percent: cur === next ? 100 : Math.max(2, Math.min(100, Math.round((exp - cur.need) / span * 100)))
  };
}

/** 从今天往回数连续打卡天数；今天未打卡则从昨天起算 */
function streakOf(checkIns, today) {
  const set = {};
  checkIns.forEach(function (c) { set[c.date] = true; });
  let t = d.parse(today) || new Date();
  if (!set[d.fmt(t)]) t = d.addDays(t, -1);
  let n = 0;
  while (set[d.fmt(d.addDays(t, -n))]) n++;
  return n;
}

function longestStreakOf(checkIns) {
  const days = Object.keys(checkIns.reduce(function (m, c) { m[c.date] = 1; return m; }, {})).sort();
  let best = 0, run = 0, prev = null;
  days.forEach(function (s) {
    const day = d.parse(s);
    if (prev && d.diffDays(prev, day) === 1) run++;
    else run = 1;
    best = Math.max(best, run);
    prev = day;
  });
  return best;
}

function summarize(tasks, checkIns, today) {
  const ref = d.parse(today) || new Date();
  const focusMinutes = checkIns.reduce(function (t, c) { return t + (c.focusMinutes || 0); }, 0);
  const registered = tasks.filter(function (t) { return t.registered; }).length;
  const stats = {
    tasks: tasks.length,
    registered: registered,
    checkIns: checkIns.length,
    focusCount: checkIns.filter(function (c) { return c.focusMinutes > 0; }).length,
    focusMinutes: focusMinutes,
    tasksWithScore: tasks.filter(function (t) {
      const s = d.parse(t.scoreStart);
      return !!s && s < ref;
    }).length,
    streak: streakOf(checkIns, today),
    longest: longestStreakOf(checkIns)
  };
  stats.exp = stats.checkIns * EXP.checkIn + stats.focusCount * EXP.focus +
    registered * EXP.registered + stats.tasksWithScore * EXP.taskDone;
  stats.level = levelOf(stats.exp);
  stats.badges = BADGES.map(function (b) {
    return { key: b.key, name: b.name, icon: b.icon, earned: !!b.test(stats) };
  });
  return stats;
}

module.exports = { EXP, LEVELS, CHAPTERS, BADGES, levelOf, streakOf, longestStreakOf, summarize };
