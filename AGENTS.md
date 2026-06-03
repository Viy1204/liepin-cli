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
| `LIEPIN_HEADLESS` | 是否无头模式 | `false` |
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
| `greet` | 向候选人打招呼（⚠️ 未验证，端点可能已失效） |
| `joblist` | 查看职位列表 |

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
