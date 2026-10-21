# #23：本机复现与实验结果

2026-10-16，Windows，Node 24.9.0，Chrome 154.0.8037.98，puppeteer-core 24.43.1。使用同一现有有头浏览器与登录态，没有重启浏览器、重新扫码、复制 cookie 或发送消息。

## 已复现的故障

原附件 controller 的简历预览流程在本机也会进入 `about:blank`。清页发生在断开连接之前，因此不能归因于 `disconnect()`。

18:40:50 的真实页面采集得到以下顺序，时间为 UTC+8：

1. 安全脚本的 `y` 控制台耗时探针返回 `detected=true`；已计算的 `tableMin=25.199999928ms`、`logMax=0.399999976ms`。
2. 约 320ms 后进入同一脚本的导航调用。
3. Chrome 报告 `scriptInitiated`，主 frame 进入 `about:blank`。

采集断点位于耗时测量结束之后，但调试器仍可能影响整个应用；另一次完全没有 Debugger 的稳定点击流程也发生清页。由此可确认本次采集中的直接清页机制，不能推断所有历史故障都来自同一个探针。

当前真实页面加载的公开 `security.min.js` 与下载副本 SHA256 一致：`daac45187474079984300055ec0aca3a7b11e1199fab1df5788883ce6ba589de`。原始证据和脱敏事件保留在本机招聘工作区 `runtime/liepin-issue23-repro-20261016/`，不上传简历正文、候选人标识或私有 controller 全文。

## 排除与对照

| 条件 | 结果 |
|---|---|
| 原关闭按钮 `ElementHandle.click()`，页面处于后台 | 等待 IntersectionObserver，出现长时间挂起；稳定点击 helper 单独解决这个问题 |
| 只改稳定关闭点击，继续使用 Puppeteer | 仍清页 |
| 移除 Debugger 采集，继续使用 Puppeteer | 仍清页 |
| 改 WebDriver BiDi | 18:47:19 仍清页 |
| 每个命令独立进程、尽快断开 | 18:49:52 打开预览过程中仍清页 |
| 最小 DOM/Input 连接，打开并关闭预览，再持连接 60 秒 | 18:55:32–18:56:38 通过，页面正文非空，预览已关闭 |
| 同一最小连接，页面入口点击、两次搜索，间隔 15 秒，再持连接 60 秒 | 18:56:43–18:58:09 通过；最终输入“图形学 渲染”，20 张 DOM 结果卡，正文非空 |

最小连接不订阅 console 调试事件，不发送 `Runtime.enable`、`Runtime.disable` 或 `Debugger.*`。保留普通页面读取、滚动、鼠标键盘输入与导航事件；没有改动 console、安全脚本、浏览器身份或清页行为。真实测试无其他测试浏览器并行运行，用户确认未手动操作猎聘浏览器。

## 交付文件回验

同日 19:00–19:02，再直接执行本目录 `controller.mjs`，而非仅验证 runtime 原型：

```json
{"command":"mapping-search-once","url":"https://lpt.liepin.com/search","bodyLength":4291,"searchValue":"图形学","resultCards":20,"visibleClose":1}
{"command":"open-card-preview","url":"https://lpt.liepin.com/recommend","bodyLength":14443,"searchValue":"","resultCards":0,"visibleClose":1}
{"command":"close-preview","url":"https://lpt.liepin.com/recommend","bodyLength":4717,"searchValue":"","resultCards":0,"visibleClose":0}
```

搜索与关闭命令均附 `--observe-ms 60000 --trace-methods`，退出码为 0。方法计数确认未启用 Runtime 事件或 Debugger。搜索摘要的 `visibleClose` 统计通用关闭 selector，不能单独解释为预览是否打开；预览验收在 `/recommend` 完成。切回推荐页使用一次现有 `liepin recommend`，没有重启或重登。

构建与测试：`npm run build` 成功，原 `npm test` 94/94；`node --test experiments/issue23-ui/controller.test.mjs` 5/5，无跳过。新测试使用假 CDP 与合成 DOM，不访问招聘账号；独立审查未发现阻塞项。

## 结论边界

本实验说明减少驱动调试订阅后，这组本机 UI 复现步骤可以完成。尚未证明这是唯一影响因素，也未覆盖 macOS、Chrome 155、对方控制器的其他分支或长期运行。它不是整个 liepin-cli 的替换驱动，不能宣布 #23 已全面解决。

搜索验收检查输入回读、DOM 卡片和页面存活，没有采集业务响应，因此不把它表述为 API 结果与 DOM 身份的一致性验收。所有实验均无候选人联系动作。
