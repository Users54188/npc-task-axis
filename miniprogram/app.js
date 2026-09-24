const kb = require('./utils/kb');
const config = require('./utils/config');
const store = require('./utils/store');

App({
  globalData: {
    cloudEnv: config.CLOUD_ENV,   // 来自 utils/config.js，填入后即启用在线存储
    offline: true,                // 未配置云环境时走本地存储，保证 touristappid 可全流程演示
    uid: '',
    today: ''
  },

  onLaunch() {
    this.globalData.today = kb.todayStr();

    if (wx.cloud && this.globalData.cloudEnv !== null) {
      try {
        wx.cloud.init({
          env: this.globalData.cloudEnv || undefined,
          traceUser: true
        });
        this.globalData.offline = false;
      } catch (e) {
        this.globalData.offline = true;
      }
    } else {
      this.globalData.offline = true;
    }

    if (wx.getStorageSync('uid')) {
      this.globalData.uid = wx.getStorageSync('uid');
    }

    // 先把上次断网攒下的写操作补推，再挂实时监听
    if (!this.globalData.offline) {
      store.flush().then(function () {
        store.startWatch();
      });
    }
  },

  onHide() {
    // 退到后台不保留长连接，回前台由 onShow 重新 pull + 订阅
    store.stopWatch();
  },

  onShow() {
    this.globalData.today = kb.todayStr();
    if (!this.globalData.offline) {
      store.startWatch();
      store.flush();
    }
  }
});
