const store = require('../../utils/store');
const kb = require('../../utils/kb');
const game = require('../../utils/game');
const d = require('../../utils/date');

const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
const LABEL = { focus: '专注', short: '短休', long: '长休' };
const DEFAULT_TAGS = ['刷题', '实操', '背诵', '模考', '整理笔记'];

function mmss(sec) {
  const s = Math.max(0, sec);
  return d.pad2(Math.floor(s / 60)) + ':' + d.pad2(s % 60);
}

Page({
  data: {
    mode: 'focus',
    modeLabel: '专注',
    running: false,
    remain: DUR.focus,
    remainText: '25:00',
    percent: 0,
    tags: DEFAULT_TAGS,
    tag: '',
    tasks: [],
    taskId: '',
    todayCount: 0,
    todayMinutes: 0,
    stats: null,
    finished: 0
  },

  /**
   * 番茄钟必须用时间戳基准，不能用 setInterval 累加：
   * 小程序切后台后 JS 会被挂起，回调不再触发，累加值会与真实时间脱节。
   * 这里只记 anchorAt / anchorRemain，每次 tick 用 Date.now() 反算，
   * 因此被挂起多久回来都能一次校正。
   */
  onLoad() {
    this.anchorAt = 0;
    this.anchorRemain = DUR.focus;
    this.setData({ tags: wx.getStorageSync('focusTags') || DEFAULT_TAGS });
  },

  onShow() {
    this.refresh();
    if (this.data.running && !this.timer) this.startTicker();
    if (this.data.running) this.tick();
    if (!this._unsub) {
      this._unsub = store.onSync(function (evt) {
        // 计时进行中不重算，避免远端回包打断倒计时
        if (this.data.running) return;
        if (evt.type === 'watch' || evt.type === 'pull' || evt.type === 'flushed') this.refresh();
      }.bind(this));
    }
  },

  onHide() {
    clearInterval(this.timer);
    this.timer = null;
    if (this._unsub) { this._unsub(); this._unsub = null; }
  },

  onUnload() {
    this.onHide();
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
  },

  refresh() {
    const today = kb.todayStr();
    return Promise.all([store.listTasks(), store.listCheckIns()]).then(function (res) {
      const tasks = res[0] || [];
      const checks = res[1] || [];
      const mine = checks.filter(function (c) {
        return c.date === today && c.focusMinutes > 0 &&
          (!this.data.taskId || c.nodeId === this.data.taskId);
      }.bind(this));
      const cur = this.data.taskId
        ? tasks.filter(function (t) { return t._id === this.data.taskId; }.bind(this))[0]
        : tasks[0];

      this.setData({
        tasks: tasks,
        taskId: cur ? cur._id : '',
        todayCount: mine.length,
        todayMinutes: mine.reduce(function (s, c) { return s + (c.focusMinutes || 0); }, 0),
        stats: game.summarize(tasks, checks, today)
      });
    }.bind(this));
  },

  onMode(e) {
    if (this.data.running) {
      wx.showToast({ title: '请先结束当前计时', icon: 'none' });
      return;
    }
    this.applyMode(e.currentTarget.dataset.mode);
  },

  startTicker() {
    clearInterval(this.timer);
    this.timer = setInterval(this.tick.bind(this), 1000);
  },

  start() {
    this.anchorAt = Date.now();
    this.anchorRemain = this.data.remain;
    this.setData({ running: true });
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: this.data.mode === 'focus' });
    this.startTicker();
  },

  pause() {
    this.tick();
    clearInterval(this.timer);
    this.timer = null;
    this.setData({ running: false });
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
  },

  reset() {
    this.stopTimer();
    this.applyMode(this.data.mode);
  },

  tick() {
    const elapsed = Math.floor((Date.now() - this.anchorAt) / 1000);
    const total = DUR[this.data.mode];
    const remain = Math.max(0, this.anchorRemain - elapsed);
    this.setData({
      remain: remain,
      remainText: mmss(remain),
      percent: Math.round((total - remain) / total * 100)
    });
    if (remain <= 0) this.complete();
  },

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
    this.setData({ running: false });
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
  },

  applyMode(mode) {
    this.anchorRemain = DUR[mode];
    this.setData({
      mode: mode, modeLabel: LABEL[mode],
      remain: DUR[mode], remainText: mmss(DUR[mode]), percent: 0
    });
  },

  /** 记录一段专注：写入打卡表，focusMinutes 为实际时长 */
  logFocus(minutes, note) {
    if (!this.data.taskId || minutes < 1) return Promise.resolve(null);
    const tag = this.data.tag || '专注';
    return store.addCheckIn({
      nodeId: this.data.taskId,
      date: kb.todayStr(),
      subject: tag,
      stage: '番茄钟',
      note: note,
      focusMinutes: minutes,
      tags: [tag]
    }).then(function () { return this.refresh(); }.bind(this));
  },

  complete() {
    const wasFocus = this.data.mode === 'focus';
    const minutes = Math.round(DUR[this.data.mode] / 60);
    this.stopTimer();
    wx.vibrateLong && wx.vibrateLong();

    const cycles = this.data.finished + (wasFocus ? 1 : 0);
    this.applyMode(wasFocus ? (cycles % 4 === 0 ? 'long' : 'short') : 'focus');
    this.setData({ finished: cycles });

    const self = this;
    const done = wasFocus ? this.logFocus(minutes, '完成一段专注') : Promise.resolve();

    done.then(function () {
      wx.showModal({
        title: wasFocus ? '专注完成' : '休息结束',
        content: wasFocus
          ? '已记录 ' + minutes + ' 分钟专注。接下来 ' + LABEL[self.data.mode] + ' ' + Math.round(DUR[self.data.mode] / 60) + ' 分钟。'
          : '休息好了就开始下一段专注。',
        showCancel: false,
        confirmText: '知道了'
      });
    });
  },

  /** 提前结束：按实际经过的秒数入账，不足 1 分钟不记 */
  onFinishNow() {
    if (!this.data.running) return;
    const spent = Math.floor((Date.now() - this.anchorAt) / 1000);
    const wasFocus = this.data.mode === 'focus';
    const minutes = Math.floor(spent / 60);
    this.stopTimer();

    if (!wasFocus || minutes < 1) {
      this.applyMode(this.data.mode);
      wx.showToast({ title: '不足 1 分钟，未记录', icon: 'none' });
      return;
    }

    this.logFocus(minutes, '提前结束，专注 ' + minutes + ' 分钟').then(function () {
      this.applyMode('short');
      wx.showToast({ title: '已记 ' + minutes + ' 分钟', icon: 'none' });
    }.bind(this));
  },

  onTag(e) {
    this.setData({ tag: e.currentTarget.dataset.tag });
  },

  onAddTag() {
    const self = this;
    wx.showModal({
      title: '新标签',
      editable: true,
      placeholderText: '如 听力',
      success(res) {
        const v = (res.content || '').trim();
        if (!res.confirm || !v) return;
        const tags = self.data.tags.concat([v]).slice(0, 12);
        wx.setStorageSync('focusTags', tags);
        self.setData({ tags: tags, tag: v });
      }
    });
  },

  onPickTask(e) {
    this.setData({ taskId: e.currentTarget.dataset.id });
    this.refresh();
  }
});
