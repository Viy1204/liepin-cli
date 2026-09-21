# liepin-cli AI Agent 协作规则

## 项目概述

liepin-cli 是猎聘自动化 CLI 工具，基于 Puppeteer/CDP 驱动本机 Chrome，支持批量发消息、自动打招呼、候选人管理、人才搜索等功能。

## 核心原则

1. **安全第一** - 永远不要泄露用户凭证或敏感信息
2. **最小改动** - 只修改必须改的地方，不做推测性改动
3. **错误透明** - 遇到错误直接报告，不要静默失败
4. **人类行为模拟** - 所有浏览器操作都要模拟人类行为，避免被检测

## 技术栈

- **运行时**: Node.js ≥ 20
- **语言**: TypeScript (ES Module)
- **浏览器自动化**: Puppeteer-core + CDP 协议
- **目标网站**: www.liepin.com

## 代码规范

### 命名规范

- 文件名: 小写 + 连字符 (e.g., `chat-list.ts`)
- 类名: 大驼峰 (e.g., `CdpBrowser`)
- 函数名: 小驼峰 (e.g., `navigateTo`)
- 常量: 大写下划线 (e.g., `LIEPIN_API`)

### 错误处理

```typescript
// 好的错误处理
try {
  await someOperation();
} catch (error) {
  throw new Error(`操作失败: ${error instanceof Error ? error.message : String(error)}`);
}

// 不好的错误处理
try {
  await someOperation();
} catch {
  // 静默失败
}
```

**退出码契约**（编排脚本 / Agent 依赖，不要改动语义）：`0` 成功；`1` 一般错误；
`2` 登录态失效（`AuthExpiredError`，先 `liepin login`）；`3` 风控/安全异常
（`RiskControlError`，包括页面被猎聘安全脚本清空为 about:blank，立即停止自动化）。

### 浏览器默认有头且跨命令常驻（重要）

浏览器**默认有头**（2026-09-21 翻的默认，此前无头），且**命令结束只断 CDP、不关浏览器**——
下条命令直连同一只常驻实例（同一登录态、同一标签），DSH 的「招聘浏览器」面板也靠这个才能
挂上来镜像。

**❗别把默认改回无头。** 本 CLI 刻意不覆盖 User-Agent（伪造 UA 与 sec-ch-ua Client Hints、
真实平台矛盾，本身就是更强的指纹），所以无头下猎聘收到的 UA 明晃晃带着 `HeadlessChrome/<ver>`，
等于每个请求自报「我是第三方辅助工具」。BOSS 侧已因此被限 web 端登录；猎聘侧 2026-09-20 实测
连续无头调用后账号被判「行为异常」、302 到 `captchaPage_PC`、业务接口静默拦截。
完整依据见 `resolveHeadlessFromEnv()` 的注释。

- 占固定调试端口 **53471**（`LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT` 可覆盖），boss-cli 是 53470。
- **不要改回 `puppeteer.launch()`**：它依赖的 `@puppeteer/browsers` 会在 Node 进程 exit 时
  kill 浏览器子进程，launch 出来的浏览器活不过一条命令，常驻和镜像都没了。必须自己
  `spawn(detached)` + `puppeteer.connect`。
- 关浏览器只有一个出口：`liepin quit`。别在命令路径里加 `browser.close()`。

**Windows 上必须让浏览器脱离调用方的 Job Object**（issue #21）：Agent 宿主一般把整棵进程树
放进 `KILL_ON_JOB_CLOSE` 的 Job，`spawn({ detached: true })` 只是新建进程组、逃不出 Job，
CLI 一结束 Chrome 就被连带杀掉（窗口"自己关了"、profile 变 `Crashed`、会话 cookie 丢失 →
被迫重新扫码 → 又一次重启……）。所以 Windows 默认经 WMI `Win32_Process.Create` 拉起浏览器
（父进程是 WmiPrvSE，不在 Job 里，但仍在交互会话中，有头窗口照常可见），
`LIEPIN_SPAWN_BREAKAWAY=false` 可回退。**别改回单纯的 `spawn(detached)`**。

**要把浏览器藏起来时**（用户嫌窗口抢焦点，且已被告知上面的风控代价）：

```bash
RECRUIT_BROWSER_HIDDEN=true liepin <cmd>   # 或 LIEPIN_HEADLESS=true（优先级更高）
```

已有实例在跑时改变量**不生效**（端口上已有实例会被直接复用），要先 `liepin quit`。

### login 默认复用，别再无条件重启浏览器（issue #21）

`login` 先探一次登录态，**还有效就直接返回**，不碰端口上那只浏览器；只有确实要人工扫码时
才把无头实例换成有头。24 小时内交互式登录超过 3 次会被拦下，`--force` 才放行。

这条是账号安全约束，不是性能优化：猎聘的会话 cookie `is_persistent=0`，关浏览器 = 退出登录，
而"重登"又要关浏览器——旧实现让重试登录变成自我强化的循环，直接把账号喂成了「行为异常」。
**不要为了"确保干净状态"在 login 路径上加 `closeRemoteBrowser()`。**

### 风控形态有两种，都要立即停

1. **页面被清空成 about:blank** —— 加载期 CDP 检测（issue #17），`safeGoto` 规避；
2. **被 302 到 `safe.liepin.com/.../captchaPage_PC`** —— 账号被判「行为异常」，
   此时业务接口只回一个**没有 msg 的 `{"flag":0}`**（不是权益不足！），
   `assertLptPageAlive` / `lptFetch` 都会抛 `RiskControlError`（退出码 3）。

`login` 是唯一例外：人就该停在验证页上过滑块，所以它只用 `assertPageNotBlanked`。

**判断在跑的实例是什么模式**：读 `http://127.0.0.1:53471/json/version` 的 `User-Agent`，
含 `HeadlessChrome` 即无头（`probeRemoteHeadless()`）。**不要**用进程内变量判断——每条
liepin 命令都是独立进程，进程内状态刚起时必然是空的。`login` 就是靠这个判据把无头实例
关掉再以有头重启的（见 `src/cli/index.ts`）。

无头下额外带 `--screen-info={0,0 1920x1080 workAreaBottom=40}`：无头虚拟屏默认 800x600 是
已知的强自动化指纹，而 `--window-size` 抬不动它，只有 `--screen-info` 能（Chrome 142+，
仅无头有效）。四个 workArea 参数必须分开写，写成 `workArea=` 会让 Chrome 直接启动失败。

### 浏览器操作

```typescript
// 好的浏览器操作
await page.goto(url, { waitUntil: 'networkidle2' });
await sleepRandom(500, 1500); // 模拟人类行为

// 不好的浏览器操作
await page.goto(url); // 没有等待
// 没有延迟
```

### Puppeteer evaluate 约束

本项目用 `tsc`（非 esbuild）编译，函数回调形式的 `page.evaluate` 不会触发
`__name is not defined`，因此直接传函数即可，参数通过 `evaluate` 的后续实参注入。

```typescript
// 当前用法：函数回调 + 实参注入（见 common/utils.ts、common/lpt-utils.ts）
await page.evaluate(async (url, body) => {
  const res = await fetch(url, { method: 'POST', body });
  return await res.text();
}, fetchUrl, fetchBody);
```

> 注意：回调体在浏览器上下文执行，不能引用 Node 侧的闭包变量，所有数据必须经实参传入。

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `CHROME_PATH` | Chrome/Edge 可执行文件路径；macOS 常见安装路径会自动检测 | - |
| `PUPPETEER_EXECUTABLE_PATH` | Puppeteer 可执行文件路径 | - |
| `LIEPIN_USER_DATA_DIR` | 用户数据目录 | `~/.liepin-cli/user-data` |
| `LIEPIN_SCREENSHOT_DIR` | 截图目录 | `~/.liepin-cli/screenshots` |
| `LIEPIN_CONFIG_DIR` | 配置目录 | `~/.liepin-cli` |
| `RECRUIT_BROWSER_HIDDEN` | 招聘工具链共读的隐藏开关；`true` 让窗口隐藏（有风控代价，见上） | 不设（默认有头） |
| `LIEPIN_HEADLESS` | 本 CLI 专属覆盖项，优先级高于上一行 | 跟随上一行 |
| `LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT` | 固定 CDP 调试端口 | `53471` |
| `LIEPIN_SPAWN_BREAKAWAY` | 仅 Windows：经 WMI 拉起浏览器以脱离 Job Object；`false` 回退普通 spawn | `true` |
| `LIEPIN_PROXY` | 代理服务器 | - |
| `LIEPIN_DEBUG` | 调试模式 | `false` |

## 命令列表

| 命令 | 说明 |
|------|------|
| `search` | 搜索人才 |
| `chatlist` | 查看聊天列表 |
| `chatmsg` | 查看与某候选人的聊天记录（入参为对方 imId） |
| `recommend` | 查看推荐候选人 |
| `talent` | 查看人才库 |
| `resume` | 查看简历详情（入参为 resume_id） |
| `greet` | 向候选人打招呼（一键沟通，使用职位预设招呼语；入参为候选人 user_id） |
| `request-phone` | 向候选人索要手机号（点 IM 会话的快捷按钮，需先 greet 建会话） |
| `request-resume` | 向候选人索要简历（同上） |
| `joblist` | 查看职位列表 |
| `quit` | 关掉常驻浏览器（登录态保留；`requiresPage: false`） |

## 反检测策略

1. **随机延迟** - 所有操作之间添加 500-1500ms 随机延迟
2. **User-Agent** - 使用真实浏览器的 User-Agent
3. **视口设置** - 模拟真实浏览器视口大小
4. **Cookie 管理** - 使用浏览器原生 Cookie
5. **请求头** - 模拟真实浏览器请求头

## 调试技巧

1. **启用调试模式** - 设置 `LIEPIN_DEBUG=true`
2. **查看截图** - 截图保存在 `~/.liepin-cli/screenshots`
3. **查看日志** - 使用 `console.error` 输出调试信息
4. **非无头模式** - 设置 `LIEPIN_HEADLESS=false` 查看浏览器操作

## 常见问题

### Chrome 未找到

```
错误: Chrome/Edge 可执行文件路径未设置
```

解决方案:
```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# 或
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### 登录失败

```
错误: 未登录
```

解决方案:
1. 先手动登录猎聘网站
2. 确保 `LIEPIN_USER_DATA_DIR` 目录正确
3. 检查 Cookie 是否过期

### 被检测为自动化

```
错误: 检测到自动化操作
```

解决方案:
1. 增加随机延迟
2. 检查 User-Agent
3. 使用代理
4. 减少操作频率
