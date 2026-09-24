const store = require('../../utils/store');
const kb = require('../../utils/kb');
const game = require('../../utils/game');
const config = require('../../utils/config');
const d = require('../../utils/date');

Page({
  data: {
    today: '',
    year: 0,
    month: 0,
    monthText: '',
    cells: [],
    tasks: [],
    taskId: '',
    task: null,
    stages: [],
    checkIns: [],
    stats: null,
    badgeCount: 0,
    form: { subject: '', stage: '', note: '', date: '' },
    askedSubscribe: false
  },

  onLoad() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1 });
  },

  onShow() {
    this.refresh();
    this._unsub = store.onSync(function (evt) {
      if (evt.type === 'watch' || evt.type === 'pull' || evt.type === 'flushed') this.refresh();
    }.bind(this));
  },

  onHide() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  },

  onUnload() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  },

  refresh() {
    const today = kb.todayStr();
    return Promise.all([store.listTasks(), store.listCheckIns()]).then(function (res) {
      const tasks = res[0] || [];
      const checks = res[1] || [];
      const first = tasks[0];
      const cur = this.data.taskId
        ? tasks.filter(function (t) { return t._id === this.data.taskId; }.bind(this))[0] || first
        : first;

      const sum = game.summarize(tasks, checks, today);

      this.setData({
        today: today,
        tasks: tasks,
        checkIns: checks,
        stats: sum,
        badgeCount: sum.badges.filter(function (b) { return b.earned; }).length,
        taskId: cur ? cur._id : '',
        task: cur || null,
        stages: this.buildStages(cur, checks)
      });
      this.buildCells();
    }.bind(this));
  },

  /** 阶段完成率：该阶段区间内的打卡天数 / 阶段总天数 */
  buildStages(task, checks) {
    if (!task || !task.plan) return [];
    return task.plan.map(function (p) {
      const s = d.parse(p.start);
      const e = d.parse(p.end);
      const total = s && e ? Math.max(1, d.diffDays(s, e) + 1) : 0;
      const hit = checks.filter(function (c) {
        if (c.nodeId !== task._id) return false;
        const day = d.parse(c.date);
        return !!s && !!e && day >= s && day <= e;
      }).length;
      return {
        idx: p.idx, name: p.name, focus: p.focus, subjects: p.subjects || [],
        start: p.start, end: p.end, weeks: p.weeks,
        done: hit, total: total,
        percent: total ? Math.min(100, Math.round(hit / total * 100)) : 0
      };
    });
  },

  buildCells() {
    const y = this.data.year;
    const m = this.data.month;
    const today = d.parse(this.data.today);
    const byDate = {};
    this.data.checkIns.forEach(function (c) {
      if (this.data.taskId && c.nodeId !== this.data.taskId) return;
      byDate[c.date] = (byDate[c.date] || 0) + 1;
    }.bind(this));

    const cells = d.monthMatrix(y, m).map(function (day) {
      const key = d.fmt(day);
      const inMonth = day.getMonth() + 1 === m && day.getFullYear() === y;
      let state = 'blank';
      if (inMonth) {
        if (byDate[key]) state = 'ok';
        else if (day < today) state = 'miss';
        else if (+day === +today) state = 'today';
        else state = 'idle';
      }
      return { key: key, day: day.getDate(), inMonth: inMonth, state: state, count: byDate[key] || 0 };
    });
    this.setData({ cells: cells, monthText: d.monthLabel(y, m) });
  },

  onPrevMonth() {
    let y = this.data.year, m = this.data.month - 1;
    if (m < 1) { m = 12; y--; }
    this.setData({ year: y, month: m }, this.buildCells.bind(this));
  },

  onNextMonth() {
    let y = this.data.year, m = this.data.month + 1;
    if (m > 12) { m = 1; y++; }
    this.setData({ year: y, month: m }, this.buildCells.bind(this));
  },

  onPickTask(e) {
    const id = e.currentTarget.dataset.id;
    const task = this.data.tasks.filter(function (t) { return t._id === id; })[0];
    this.setData({
      taskId: id, task: task,
      stages: this.buildStages(task, this.data.checkIns),
      'form.stage': task && task.plan && task.plan[0] ? task.plan[0].name : ''
    });
    this.buildCells();
  },

  /** 点空白/漏打卡的日期 → 补卡；点今天 → 直接打卡 */
  onCell(e) {
    const cell = this.data.cells[Number(e.currentTarget.dataset.i)];
    if (!cell || !cell.inMonth) return;
    if (cell.state === 'ok') {
      wx.showToast({ title: '这天已打卡 ' + cell.count + ' 次', icon: 'none' });
      return;
    }
    if (cell.state === 'idle' || cell.state === 'blank') {
      wx.showToast({ title: '未来的日期不能提前打卡', icon: 'none' });
      return;
    }
    this.setData({ 'form.date': cell.key });
  },

  onForm(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ ['form.' + f]: e.detail.value });
  },

  onSubmit() {
    const f = this.data.form;
    if (!this.data.taskId) { wx.showToast({ title: '请先选择任务', icon: 'none' }); return; }
    if (!f.subject.trim()) { wx.showToast({ title: '请填写科目', icon: 'none' }); return; }
    const date = f.date || this.data.today;
    if (date > this.data.today) { wx.showToast({ title: '不能给未来打卡', icon: 'none' }); return; }

    const self = this;
    const makeup = date !== this.data.today;

    this.askSubscribe().then(function () {
      return store.addCheckIn({
        nodeId: self.data.taskId,
        date: date,
        subject: f.subject.trim(),
        stage: f.stage || (self.data.stages[0] ? self.data.stages[0].name : ''),
        note: f.note,
        makeup: makeup
      });
    }).then(function () {
      wx.showToast({ title: makeup ? '已补卡' : '打卡成功 +5 EXP', icon: 'none' });
      self.setData({ form: { subject: '', stage: f.stage, note: '', date: '' } });
      return self.refresh();
    });
  },

  /**
   * 一次性订阅消息：个人主体 + 工具类目通常拿不到长期订阅，
   * 所以每次用户主动打卡时顺带申请一条额度，页面生命周期内只问一次。
   */
  askSubscribe() {
    const ids = config.SUBSCRIBE_TMPL_IDS || [];
    if (this.data.askedSubscribe || !ids.length || !wx.requestSubscribeMessage) {
      return Promise.resolve();
    }
    this.setData({ askedSubscribe: true });
    return new Promise(function (resolve) {
      wx.requestSubscribeMessage({
        tmplIds: ids,
        success(res) { ids.forEach(function (t) { store.subscribeLog(t, res[t] === 'accept'); }); resolve(); },
        fail() { resolve(); }
      });
    });
  },

  onNewTask() {
    wx.navigateTo({ url: '/pages/task-detail/task-detail?mode=new' });
  }
});
