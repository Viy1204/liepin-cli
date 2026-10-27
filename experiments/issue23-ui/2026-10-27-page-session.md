# 2026-10-27：生产页面会话修复与验收

环境：Windows 10，Node 24.9.0，Chrome 154.0.8037.98，puppeteer-core 24.43.1。

## 已复现

原有 `CdpBrowser.launch()` 创建 Puppeteer Page。在已正常渲染的招聘简历详情页保持单个连接，不点击、不导航，观察输出先后为：

```text
{"elapsedMs":128,"url":"https://lpt.liepin.com/resume/detail"}
{"elapsedMs":15325,"url":"https://lpt.liepin.com/resume/detail"}
{"elapsedMs":30445,"url":"https://lpt.liepin.com/resume/detail"}
AssertionError: 持有CLI连接时主页面被清空或导航离开
```

随后只读请求本机调试端口的 `/json/list`，确认同一主标签页 URL 和标题均为 `about:blank`。已断开连接，未刷新、重登、重启或发送候选人消息。子框架初始化的 blank 不计为本故障。

之前的短时查询、单连接读取、额外 Runtime 连接对照均曾通过，不能把“两个工具同时连接”或“刚调用命令”当作必然触发条件。此次未采集站点脚本的调用栈；不据此认定历史控制台探针是当前唯一成因。

## 实现

保留 Puppeteer Browser 连接、独立 profile、有头 Chrome、WMI 启动和跨命令复用。生产路径改为公开 `Target.createCDPSession()` 与 `RecruitPageSession`，只实现业务使用的 `url/goto/evaluate/waitForSelector/click`。

页面仅订阅 Page 导航与加载事件，按需执行 Runtime 求值和 DOM/Input 操作。不启用 `Runtime.enable`、`Log.enable`、`Performance.enable` 或 `Debugger.*`；不改写站点 console、安全脚本、User-Agent 或验证码。删除原导航与登录探测的 Runtime 开关。

主标签清空、执行期间导航、断连统一抛 `PageUnavailableError`，继承 `RiskControlError` 并保留退出码 3。初始化清理失败保留首个错误；已有空白页禁止自动恢复；本次新建页的初始空白资格在导航开始时撤销。登录探测不再把页面失效当作可继续的验证码等待。

## 离线与隔离浏览器验证

最终源码冻结后 `npm run build` 成功，`npm test` 131/131 通过，0 失败、0 跳过。独立复核确认目标身份、新实例启动、初始化错误保留及登录停止分支的四项阻塞均已闭合。另可执行：

```bash
node experiments/issue23-ui/subscription-probe.mjs adapter production
```

此命令只使用新建的临时 profile 和本地 HTML。`production` 模式分配独立调试端口，不能使用真实猎聘端口 53471；结束后关闭测试浏览器并删除测试 profile。

已验证输出：

```json
{"mode":"adapter","bodyPresent":true,"clickedOnce":true,"argsPreserved":true,"sameDocumentNavigation":true,"exceptionsPreserved":true,"disconnectStopsWaiting":true,"subscriptions":{"Runtime.enable":0,"Log.enable":0,"Performance.enable":0,"Debugger.enable":0}}
{"mode":"production","initialBrowserCreated":true,"clickedOnce":true,"subscriptions":{"Runtime.enable":0,"Log.enable":0,"Performance.enable":0,"Debugger.enable":0}}
```

第二行省略了每次动态分配的测试端口。对照 `page` 模式记录到 Runtime、Log、Performance 各启用一次，确认订阅差异来自真实浏览器协议。早期使用对象字符串化计数的实验在各模式中无区分力，已移除，不作为根因证据。

新增行为测试覆盖主 frame 与子 frame 区分、loader/重定向/同文档导航、导航后读取、JSON/undefined 参数、一次真实 Input 点击、异常传播、等待超时、断连取消、已有 blank 停止与清理错误身份保留。修复过程中已捕获三项失败：清理覆盖风险错误、卡住的 DOM 查询突破 selector 超时、首次导航后的 blank 被初始资格放行；对应回归已修。

## 在线验收边界

用户手动恢复原窗口的推荐页并明确授权继续后，使用修复后的生产 `CdpBrowser` 读取已有会话、解析当前简历 ID、读取同一候选人的简历，再导航到详情页；以上步骤全部成功。随后保持同一页面连接 95 秒，每隔约 15 秒检查主页面 URL，最终页面正文为 2138 字符，未出现 blank；正常断开连接，保留浏览器。

```json
{"result":"live-page-held-without-blank","url":"https://lpt.liepin.com/resume/detail","bodyLength":2138,"subscriptions":{"Runtime.enable":0,"Log.enable":0,"Performance.enable":0,"Debugger.enable":0},"totalMs":104496}
```

这证明当前本机环境的读取与持续停留回验通过。尚未覆盖其他 Chrome 版本、其他并行客户端或长期运行，不把一次通过表述为所有清页原因已被排除。候选人发送、索简历和未读清零不在本次验证内，未执行这些动作。
