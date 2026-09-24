const store = require('../../utils/store');
const kb = require('../../utils/kb');
const axis = require('../../utils/axis');
const d = require('../../utils/date');
const config = require('../../utils/config');
const rec = require('../../utils/recognize');

const BLANK = {
  name: '', shortName: '', type: 'certificate', domain: '', site: '', place: '', fee: '',
  regStart: '', regEnd: '', admitStart: '', admitEnd: '', examDate: '', scoreStart: '', scoreEnd: '',
  registered: false, plan: [], verify: '', examApprox: false
};

Page({
  data: {
    mode: 'view',
    id: '',
    task: null,
    nodes: [],
    countdown: null,
    checkCount: 0,
    draft: null,
    matched: null,
    kbList: [],
    today: '',
    rec: { open: false, text: '', busy: false, msg: '' }
  },

  onLoad(query) {
    const today = kb.todayStr();
    this.setData({ today: today, kbList: kb.listAll() });

    if (query.mode === 'new') {
      this.setData({ mode: 'edit', draft: Object.assign({}, BLANK) });
      wx.setNavigationBarTitle({ title: '接新任务' });
      return;
    }
    this.load(query.id, today);
  },

  load(id, today) {
    const self = this;
    return store.listTasks().then(function () {
      const task = store.getTask(id);
      if (!task) {
        wx.showToast({ title: '任务不存在', icon: 'none' });
        setTimeout(function () { wx.navigateBack(); }, 800);
        return null;
      }
      self.setData({
        mode: 'view',
        id: id,
        task: task,
        nodes: axis.buildAxis([task], today),
        countdown: axis.countdownOf(task, today),
        checkCount: store.checkInsOf(id).length
      });
      wx.setNavigationBarTitle({ title: task.shortName || task.name });
      return task;
    });
  },

  /* ---------- 知识库匹配（检索，非生成） ---------- */

  onNameInput(e) {
    const val = e.detail.value;
    this.setData({ 'draft.name': val });
    clearTimeout(this._t);
    if (val.trim().length < 2) { this.setData({ matched: null }); return; }

    this._t = setTimeout(function () {
      const hit = kb.suggest(val, d.parse(this.data.today));
      this.setData({ matched: hit ? {
        key: hit.key, name: hit.name, shortName: hit.shortName, cadenceLabel: hit.cadenceLabel,
        examDate: hit.examDate, regStart: hit.regStart, regEnd: hit.regEnd,
        stageCount: hit.plan.length, scoreStart: hit.scoreStart, verify: hit.verify
      } : null });
    }.bind(this), 260);
  },

  onApplyMatch() {
    const hit = kb.suggest(this.data.draft.name, d.parse(this.data.today));
    if (!hit) { wx.showToast({ title: '没匹配到已知考试', icon: 'none' }); return; }
    const merged = Object.assign({}, this.data.draft, hit, { _id: this.data.draft._id });
    this.setData({ draft: merged });
    wx.showToast({ title: '已回填常规时间', icon: 'none' });
  },

  onPickFromKb(e) {
    const key = e.currentTarget.dataset.key;
    const entry = kb.listAll().filter(function (x) { return x.key === key; })[0];
    if (!entry) return;
    const hit = kb.suggest(entry.name, d.parse(this.data.today));
    if (!hit) { wx.showToast({ title: '该条目暂无可用考次', icon: 'none' }); return; }
    this.setData({ draft: Object.assign({}, this.data.draft, hit, { _id: this.data.draft._id }), matched: null });
  },

  /* ---------- 报名表文字识别（可选增强，默认关闭） ---------- */

  onRecToggle() {
    this.setData({ 'rec.open': !this.data.rec.open, 'rec.msg': rec.unavailableReason() });
  },

  onRecInput(e) {
    this.setData({ 'rec.text': e.detail.value });
  },

  onRecRun() {
    const self = this;
    this.setData({ 'rec.busy': true, 'rec.msg': '' });
    return rec.recognizeText(this.data.rec.text).then(function (res) {
      if (res.ok) {
        const node = res.node;
        // 识别结果只补空字段，不覆盖用户已经手工填过的内容
        const merged = Object.assign({}, self.data.draft);
        Object.keys(node).forEach(function (k) {
          if (k === 'plan') return;
          if (merged[k] === undefined || merged[k] === '' || merged[k] === null) merged[k] = node[k];
        });
        if (!merged.plan || !merged.plan.length) merged.plan = node.plan || [];
        self.setData({ draft: merged, 'rec.busy': false, 'rec.msg': '', 'rec.open': false });
        wx.showToast({ title: '已回填识别结果', icon: 'none' });
        return;
      }
      self.setData({ 'rec.busy': false, 'rec.msg': res.error });
    });
  },

  /* ---------- 表单 ---------- */

  onField(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ ['draft.' + f]: e.detail.value });
  },

  onDate(e) {
    const f = e.currentTarget.dataset.field;
    const patch = {};
    patch['draft.' + f] = e.detail.value;
    this.setData(patch);
  },

  onType(e) {
    this.setData({ 'draft.type': e.detail.value === '0' ? 'certificate' : 'contest' });
  },

  onAddStage() {
    const plan = (this.data.draft.plan || []).concat([{
      idx: (this.data.draft.plan || []).length + 1,
      name: '阶段' + ((this.data.draft.plan || []).length + 1),
      focus: '', subjects: [], weeks: 4,
      start: this.data.draft.examDate || '', end: this.data.draft.examDate || ''
    }]);
    this.setData({ 'draft.plan': plan });
  },

  onStageField(e) {
    const i = Number(e.currentTarget.dataset.i);
    const f = e.currentTarget.dataset.field;
    const plan = this.data.draft.plan.slice();
    plan[i] = Object.assign({}, plan[i]);
    plan[i][f] = e.detail.value;
    this.setData({ 'draft.plan': plan });
  },

  onStageDel(e) {
    const i = Number(e.currentTarget.dataset.i);
    const plan = this.data.draft.plan.filter(function (_, idx) { return idx !== i; })
      .map(function (p, idx) { return Object.assign({}, p, { idx: idx + 1 }); });
    this.setData({ 'draft.plan': plan });
  },

  /* ---------- 存取 ---------- */

  onSave() {
    const t = this.data.draft;
    if (!t.name || !t.name.trim()) { wx.showToast({ title: '请填写任务名称', icon: 'none' }); return; }
    if (!t.examDate) { wx.showToast({ title: '请填写考试日期', icon: 'none' }); return; }
    if (t.regEnd && t.regEnd > t.examDate) {
      wx.showToast({ title: '报名截止晚于考试，请核对', icon: 'none' });
      return;
    }
    const self = this;
    store.saveTask(t).then(function (row) {
      wx.showToast({ title: '已保存', icon: 'success' });
      return self.load(row._id, self.data.today);
    });
  },

  onEdit() {
    this.setData({ mode: 'edit', draft: Object.assign({}, this.data.task) });
  },

  onCancel() {
    if (this.data.mode === 'edit' && !this.data.id) { wx.navigateBack(); return; }
    this.setData({ mode: 'view', draft: null, matched: null });
  },

  onDelete() {
    const self = this;
    wx.showModal({
      title: '删除任务',
      content: '该任务下的打卡记录会一并删除，不可恢复。',
      confirmColor: '#F2555A',
      success(res) {
        if (!res.confirm) return;
        store.removeTask(self.data.id).then(function () { wx.navigateBack(); });
      }
    });
  },

  /**
   * 报名状态切换：开启倒计时，并顺带申请一次性订阅消息额度。
   * 个人主体 + 工具类目通常只有一性订阅，所以必须在用户主动操作时申请。
   */
  onToggleRegistered() {
    const task = Object.assign({}, this.data.task, { registered: !this.data.task.registered });
    const self = this;

    const ask = new Promise(function (resolve) {
      const ids = config.SUBSCRIBE_TMPL_IDS || [];
      if (!task.registered || !ids.length || !wx.requestSubscribeMessage) return resolve();
      wx.requestSubscribeMessage({
        tmplIds: ids,
        success(res) { ids.forEach(function (t) { store.subscribeLog(t, res[t] === 'accept'); }); resolve(); },
        fail() { resolve(); }
      });
    });

    ask.then(function () { return store.saveTask(task); }).then(function () {
      return self.load(task._id, self.data.today);
    }).then(function () {
      if (task.registered && !(config.SUBSCRIBE_TMPL_IDS || []).length) {
        wx.showModal({
          title: '提醒还发不出去',
          content: 'utils/config.js 里还没填订阅消息模板 ID。到后台「功能 → 订阅消息 → 我的模板」申请后填入即可。',
          showCancel: false
        });
      }
    });
  },

  onCopySite() {
    const site = this.data.task && this.data.task.site;
    if (!site) return;
    wx.setClipboardData({
      data: site,
      success() {
        wx.showToast({ title: '已复制，请在浏览器打开', icon: 'none' });
      }
    });
  },

  onGoCheckin() {
    wx.switchTab({ url: '/pages/checkin/checkin' });
  }
});
