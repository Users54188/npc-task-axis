const store = require('../../utils/store');
const kb = require('../../utils/kb');
const game = require('../../utils/game');
const config = require('../../utils/config');
const setup = require('../../utils/setup');

/**
 * 桌宠台词全部为本地预设，不做任何运行时生成：
 * 个人主体拿不到深度合成类目，接 AI 实时对话会卡在审核。
 */
const PET_LINES = [
  '今天还没打卡哦，经验值在等你 ⚡',
  '报名截止前 3 天，别忘了去看一眼官网 📌',
  '连续 7 天就能拿到「七日不辍」徽章 🔥',
  '来一段 25 分钟专注吧 🍅',
  '准考证别只存在手机里，也打印一份 🖨',
  '错题回炉比刷新题值钱 📖'
];

Page({
  data: {
    stats: null,
    badges: [],
    earnedCount: 0,
    petLine: PET_LINES[0],
    petIndex: 0,
    offline: true,
    cloudEnv: '',
    hasTemplate: false,
    kbVersion: '',
    setup: null,
    taskCount: 0,
    checkCount: 0,
    pendingSync: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const today = kb.todayStr();
    return Promise.all([store.listTasks(), store.listCheckIns()]).then(function (res) {
      const tasks = res[0] || [];
      const checks = res[1] || [];
      const sum = game.summarize(tasks, checks, today);
      const earned = sum.badges.filter(function (b) { return b.earned; });

      this.setData({
        stats: sum,
        badges: sum.badges,
        earnedCount: earned.length,
        taskCount: tasks.length,
        checkCount: checks.length,
        offline: store.offline(),
        cloudEnv: config.CLOUD_ENV || '未配置',
        hasTemplate: !!(config.SUBSCRIBE_TMPL_IDS && config.SUBSCRIBE_TMPL_IDS.length),
        kbVersion: kb.version,
        setup: setup.audit(),
        pendingSync: (wx.getStorageSync('syncQueue') || []).length
      });
    }.bind(this));
  },

  onPet() {
    const i = (this.data.petIndex + 1) % PET_LINES.length;
    this.setData({ petIndex: i, petLine: PET_LINES[i] });
  },

  /** 导出为 JSON 文本，便于内测同学备份 / 截图给评委看数据量 */
  onExport() {
    const payload = JSON.stringify({
      exportedAt: kb.todayStr(),
      taskNodes: store.rawTasks(),
      checkIns: store.rawCheckIns()
    });
    wx.setClipboardData({
      data: payload,
      success() {
        wx.showToast({ title: '数据 JSON 已复制', icon: 'none' });
      }
    });
  },

  onSyncNow() {
    if (store.offline()) {
      wx.showModal({
        title: '还没接上云端',
        content: '在 miniprogram/utils/config.js 填入云开发环境 ID 后重新编译，即可开启在线存储与双向同步。',
        showCancel: false
      });
      return;
    }
    store.flush().then(function (n) {
      wx.showToast({ title: '已同步 ' + n + ' 条', icon: 'none' });
      return null;
    }).then(function () { this.refresh(); }.bind(this));
  },

  onClear() {
    wx.showModal({
      title: '清空本地数据',
      content: '仅清除本机缓存，云端数据不受影响。已连接云端的账号重新拉取即可恢复。',
      confirmColor: '#F2555A',
      success: function (res) {
        if (!res.confirm) return;
        ['taskNodes', 'checkIns', 'syncQueue', 'subLog', 'focusTags'].forEach(function (k) {
          wx.removeStorageSync(k);
        });
        wx.showToast({ title: '已清空', icon: 'none' });
        this.refresh();
      }.bind(this)
    });
  },

  onAbout() {
    const s = this.data.stats;
    wx.showModal({
      title: '关于与合规说明',
      content: '任务时间轴由内置知识库（' + this.data.kbVersion + ' 版，' + kb.listAll().length +
        ' 个证书/赛事条目）检索匹配生成，不在运行时调用任何生成式 AI 能力。' +
        '考试日期为常规窗口，请以当年官方公告为准。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onShareAppMessage() {
    const s = this.data.stats;
    return {
      title: s ? '我已升到 Lv.' + s.level.lv + '，' + s.checkIns + ' 次备考打卡' : '大学 NPC 任务轴',
      path: '/pages/timeline/timeline'
    };
  }
});
