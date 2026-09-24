# 大学 NPC 任务轴

面向大学生的游戏化备考工作台 · 2026 微信小程序开发大赛参赛作品。

仓库：https://github.com/Users54188/npc-task-axis （MIT License）

把证书考试与专业赛事的**报名 / 准考证 / 考试 / 查分**四类节点排成一条任务轴，
临期自动高亮，已报名自动生成考试倒计时，再用阶段打卡 + 经验等级把备考过程游戏化。

## 当前完成度

```bash
npm test          # 174 条断言全绿
# 知识库 11 · 服务端校验 14 · 长图 9 · 时间轴与养成 15 · 抽取校验 10 · 提醒计划 12 · 同步合并 23 · 数据层端到端 12 · 页面逻辑 22 · WXML 模板 18 · 配置自检 9 · 端到端旅程 10 · 工程结构 9
npm run preview   # 真实 WXML + 真实页面数据 + 真实 WXSS → output/preview/pages-preview.html
```

页面用 `tests/helpers/page-harness.js` 直接驱动真实 `Page` 对象的生命周期与事件处理
（含路径式 `setData`、可控 `Date.now`），验证时间轴渲染、分段过滤、月历状态机、
阶段完成率、番茄钟时间戳基准与后台校正、知识库防抖命中与回填、保存校验、
报名状态切换生成倒计时。

`tests/helpers/wxml.js` 是轻量 WXML 解析器：校验标签闭合、mustache 配对、
条件链（`wx:elif/else` 是否有同级 `wx:if`）、表达式是否含模板不支持的 JS，
并用真实页面 data 渲染以捕获求值异常与 `undefined` 输出。

**它抓到一个首屏级 bug**：模板从 HTML 设计稿迁移时残留了 `<b>` `<span>` `<i>`
共 27 处 —— 这些不是 WXML 标签，真机上四个统计数字和所有进度条填充都会是空的。
`npm run preview` 的截图又暴露月历 `.cell view` 选择器落空（模板里是 `<text>`），
导致打卡底色铺满整格连成横带。

> 预览局限：无头 Chrome 缺 emoji 字体，标题里的 🗺  会显示成豆腐块；手机端微信自带
> emoji 字体不受影响。tabBar 目前是无图标纯文字，要图标需补图片资源。

已完成：知识库解析引擎、时间轴展平与临期判定、倒计时、经验/等级/连击/徽章、
本地优先 + 云开发回推的数据层、五个页面（时间轴 / 任务详情 / 阶段打卡 / 专注 / 我的）、
五个云函数（`login` / `taskNode` / `checkIn` / `recognize` / `remind`）。

工程结构由 `tests/structure.spec.js` 把守：页面三件套齐全、`require` 路径可解析、
`tabBar` 指向已注册页面、WXML 不含模板不支持的函数表达式、`bind*` 事件都有实现、
云函数声明了 `wx-server-sdk`、全仓库 JS 通过语法检查。

未接入：`recognize` 的图片 OCR 入口（见下）。

## 云开发 AI 接口（已查官方文档核实）

| 事实 | 出处 |
|---|---|
| 入口 `wx.cloud.extend.AI.createModel(model) → ChatModel` | wx.cloud.extend.AI API 参考 |
| 可用模型名：`cloudbase`、`hy3`、`deepseek-v4-flash` | 同上 |
| 方法：`generateText(data)`、`streamText({data, onText, onEvent, onFinish})` | 同上 |
| **生图（`createImageModel`）只能在云函数 / 云托管调用** | 小程序成长计划文档 |
| 仅限微信小程序与云开发服务端使用 | 同上 |
| 参与资格只要求"注册一个微信小程序账号"，文档未列主体/类目前置 | 接入指引 |

**仍未解决**：运行时调用大模型是否会让个人主体小程序在审核时被要求补深度合成类目 ——
成长计划文档说不设主体门槛，但云开发的算法备案"在用证明"明确只发给非个人主体，
两份文档指向相反。在拿到官方答复前，`recognize` 云函数默认返回 `501`（需显式配置
环境变量 `AI_MODEL` 才启用），**产品主链路完全走知识库检索，不依赖这条路径**。

`recognize` 已实现并测试的是抽取结果的规整与校验（`parse.js`，10 条断言）：
剥 ```json 围栏、日期归一、缺日期不编造、四类节点单调校验、文本截断、阶段数上限。
图片 → 文字的 OCR 源尚未选型（微信 OCR 插件 vs 腾讯云通用 OCR），确定后补 `recognizeImage`。

用微信开发者工具「导入项目」选择本目录即可运行 —— `project.config.json` 里是
`touristappid`，**不需要先注册 AppID**。未配置云环境时数据自动落在本地 Storage。

## 上线前需要你填的三处

| 位置 | 从哪拿 | 不填会怎样 |
|---|---|---|
| `miniprogram/utils/config.js` → `CLOUD_ENV` | 云开发控制台 → 环境 ID | 保持本地存储，无跨设备同步 |
| `config.js` → `SUBSCRIBE_TMPL_IDS` | 后台「功能 → 订阅消息 → 我的模板」 | 客户端不再申请额度，到点无消息可发 |
| 云函数 `remind` 环境变量 `REMIND_CONFIG` | 同上模板的 ID 与字段名（JSON） | `remind` 返回 501 并跳过，不发失败请求 |

前两处与第三处的模板 ID **必须一致**，否则用户授权了、服务端却按另一个模板发。

另外必须在后台完成的：**小程序备案**（新上线强制，管局审核 1–20 个工作日）、
服务类目（主 `教育 > 教育信息展示`，副 `工具 > 备忘录`；`效率` 不对个人主体开放）、`remind` 的**定时触发器部署**（`config.json` 已写好每天 09:00）。

## 提醒是怎么发出去的

`cloudfunctions/remind/` 每天 09:00 触发，扫全量 `taskNodes`，按档位挑出今天该发的：

| 节点 | 提前档位 | 前置条件 |
|---|---|---|
| 报名截止 | 3 / 1 / 0 天 | **未**报名才提醒 |
| 准考证打印 | 1 / 0 天 | 已报名 |
| 考试 | 7 / 3 / 1 天 | 已报名 |
| 成绩公布 | 0 天 | 已报名 |

档位设计是为了不每天重复轰炸；一次性订阅每授权一次只能发一条，
所以 `43101`（无额度）按预期计数而不是报错。日期计算在 `plan.js`（纯函数，12 条断言）。

## 合规边界（个人主体）

个人主体拿不到深度合成类目的算法备案在用证明，因此本项目**不在运行时对用户开放
任何生成式能力**。AI 的三个落点全部避开这条线：

1. **知识库匹配** —— 输入任务名，检索内置库回填常规时间与阶段计划（检索，非生成）
2. **报名表识别** —— 拍照 OCR 结构化后填入节点（判别，非生成）
3. **离线内容管线** —— `data/knowledge-base.json` 由 AI 辅助整理，线上只读

明确不做：AI 对话、AI 生图、AI 文案润色、桌宠实时互动。

## 提报与上线

- `docs/submission/上线手册.md` —— 注册备案 → 类目 → 云开发 → 订阅模板 → 部署 → 真机自测 → 提审 → 提报，逐步操作清单
- `docs/submission/说明文档.md` —— 赛事规程要求的六部分，含 10 个待填占位

## 目录

```
miniprogram/
  app.{js,json,wxss}  sitemap.json
  data/knowledge-base.json   10 个证书/赛事条目
  utils/{date,kb,axis,game,store,config}.js
  pages/{timeline,task-detail,checkin,focus,mine}/
cloudfunctions/{login,taskNode,checkIn,recognize,remind}/
tests/{kb,axis}.spec.js
```

## 已知数据风险

`knowledge-base.json` 里每个条目都有 `verify` 字段，写明该考试**哪一项每年会变、
必须回官网核对**。机考分批、校内组织报名的考试（NCRE、普通话、蓝桥杯）解析出的
日期带 `examApprox` 标记，界面上显示「约」。
