const store = require('../../utils/store');
const kb = require('../../utils/kb');
const game = require('../../utils/game');
const axis = require('../../utils/axis');
const share = require('../../utils/share');
const d = require('../../utils/date');

const SEED = ['cet4', 'ncre2ms', 'tegce-pen', 'daguang'];

Page({
  data: {
    seg: 'certificate',
    axis: [],
    shown: [],
    stats: null,
    level: null,
    alerts: 0,
    today: '',
    loading: true,
    offline: true,
    empty: false
  },

  onShow() {
    this.refresh();
    // 远端有变更时自动重算时间轴，不需要用户手动下拉
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

  onPullDownRefresh() {
    this.refresh().then(function () { wx.stopPullDownRefresh(); });
  },

  refresh() {
    const today = kb.todayStr();
    return Promise.all([store.listTasks(), store.listCheckIns()])
      .then(function (res) {
        const tasks = res[0] || [];
        const checks = res[1] || [];
        const full = axis.buildAxis(tasks, today);
        const sum = game.summarize(tasks, checks, today);

        this.setData({
          today: today,
          axis: full,
          shown: full.filter(function (n) { return n.type === this.data.seg; }.bind(this)),
          stats: sum,
          level: sum.level,
          alerts: axis.alertsOf(full),
          loading: false,
          offline: store.offline(),
          empty: tasks.length === 0
        });
      }.bind(this))
      .catch(function (e) {
        this.setData({ loading: false });
        console.error('timeline refresh failed', e);
      }.bind(this));
  },

  onSeg(e) {
    const seg = e.currentTarget.dataset.seg;
    this.setData({
      seg: seg,
      shown: this.data.axis.filter(function (n) { return n.type === seg; })
    });
  },

  onTask(e) {
    wx.navigateTo({ url: '/pages/task-detail/task-detail?id=' + e.currentTarget.dataset.id });
  },

  onNew() {
    wx.navigateTo({ url: '/pages/task-detail/task-detail?mode=new' });
  },

  /* ---------- 任务轴长图 ---------- */

  onMakeImage() {
    const model = this.data.axis.length
      ? share.buildModel(store.rawTasks(), store.rawCheckIns(), this.data.stats, this.data.today)
      : share.emptyModel(this.data.today);
    this._model = model;
    this._tasks = store.rawTasks();
    this._checks = store.rawCheckIns();

    const self = this;
    wx.showLoading({ title: '生成中…' });
    wx.createSelectorQuery().in(this).select('#axisCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        const node = res && res[0] && res[0].node;
        if (!node) {
          wx.hideLoading();
          wx.showToast({ title: '画布未就绪，稍后再试', icon: 'none' });
          return;
        }
        try {
          self._paint(node, model);
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '生成失败：' + (e.message || '未知错误'), icon: 'none' });
        }
      });
  },

  /** 750 设计宽按 dpr/2 缩放绘制，导出图片在高分屏上不发虚 */
  _paint(canvas, model) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const dpr = info.pixelRatio || 2;
    const scale = dpr / 2;

    canvas.width = Math.round(model.width * scale);
    canvas.height = Math.round(model.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    share.draw(ctx, model);

    const self = this;
    wx.canvasToTempFilePath({
      canvas: canvas,
      x: 0, y: 0,
      width: canvas.width, height: canvas.height,
      destWidth: canvas.width, destHeight: canvas.height,
      fileType: 'png',
      success(res) { self._tempPath = res.tempFilePath; self._afterPaint(); },
      fail(e) {
        wx.hideLoading();
        wx.showToast({ title: '导出图片失败', icon: 'none' });
        void e;
      }
    });
  },

  _afterPaint() {
    wx.hideLoading();
    const self = this;
    wx.showActionSheet({
      itemList: ['保存到相册', '分享给好友'],
      success(r) { if (r.tapIndex === 0) self._saveToAlbum(); },
      fail() { /* 用户取消 */ }
    });
  },

  _saveToAlbum() {
    const self = this;
    wx.saveImageToPhotosAlbum({
      filePath: this._tempPath,
      success() { wx.showToast({ title: '已存入相册', icon: 'success' }); },
      fail(e) {
        const msg = String((e && e.errMsg) || '');
        if (/auth deny|authorize|permission/i.test(msg)) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存长图需要访问相册，去设置里开启？',
            confirmText: '去设置',
            success(r) { if (r.confirm) wx.openSetting(); }
          });
          return;
        }
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },

  /** 空状态时灌入示例任务，便于演示与内测首启 */
  onSeed() {
    const today = kb.todayStr();
    const picks = kb.listAll().filter(function (e) { return SEED.indexOf(e.key) >= 0; });
    Promise.all(picks.map(function (e) {
      const s = kb.suggest(e.name, d.parse(today));
      return s ? store.saveTask(s) : null;
    })).then(function () {
      wx.showToast({ title: '已载入示例任务', icon: 'none' });
      return null;
    }).then(function () { this.refresh(); }.bind(this));
  },

  onShareAppMessage() {
    return { title: '大学 NPC 任务轴 · 报名考试查分一个不漏', path: '/pages/timeline/timeline' };
  }
});
