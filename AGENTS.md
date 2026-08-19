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

### 浏览器默认无头且跨命令常驻（重要）

浏览器**默认无头**（看不见窗口），且**命令结束只断 CDP、不关浏览器**——下条命令直连
同一只常驻实例（同一登录态、同一标签），DSH 的「招聘浏览器」面板也靠这个才能挂上来镜像。

- 占固定调试端口 **53471**（`LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT` 可覆盖），boss-cli 是 53470。
- **不要改回 `puppeteer.launch()`**：它依赖的 `@puppeteer/browsers` 会在 Node 进程 exit 时
  kill 浏览器子进程，launch 出来的浏览器活不过一条命令，常驻和镜像都没了。必须自己
  `spawn(detached)` + `puppeteer.connect`。
- 关浏览器只有一个出口：`liepin quit`。别在命令路径里加 `browser.close()`。

**要让浏览器可见时**（用户说"我看不到浏览器"、需要人工在真窗口里操作）：

```bash
RECRUIT_BROWSER_HIDDEN=false liepin <cmd>   # 或 LIEPIN_HEADLESS=false（优先级更高）
```

已有实例在跑时改变量**不生效**（端口上已有实例会被直接复用），要先 `liepin quit`。

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
| `RECRUIT_BROWSER_HIDDEN` | 招聘工具链共读的隐藏开关；`false` 让窗口可见 | `true`（无头） |
| `LIEPIN_HEADLESS` | 本 CLI 专属覆盖项，优先级高于上一行 | 跟随上一行 |
| `LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT` | 固定 CDP 调试端口 | `53471` |
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
