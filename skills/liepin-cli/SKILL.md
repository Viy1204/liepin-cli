---
name: liepin-cli
description: >-
  猎聘自动化 CLI 工具。当用户提到猎聘、liepin、招聘自动化、候选人管理、
  人才搜索、自动打招呼等功能时，使用此 skill。
---

# 猎聘 CLI (`liepin-cli`)

## 功能概述

liepin-cli 是猎聘招聘者端（lpt.liepin.com）自动化命令行工具，支持：
- 人才搜索和筛选
- 简历详情查看
- 候选人管理（推荐 / 人才库）
- 聊天列表与聊天记录
- 职位列表浏览

## 浏览器默认看不见（无头）

浏览器**默认无头**，屏幕上没有窗口——有头窗口一启动就抢键盘焦点，会打断用户手上的事。
所以「看不到浏览器」不是故障，别去排查。

浏览器还**跨命令常驻**（占固定端口 53471，命令结束只断 CDP），下条命令复用同一只、同一登录态。

- **想看浏览器在做什么** → 优先用 DSH 的「招聘浏览器」面板（实时画面推到 Web UI，能看能点，不抢焦点）
- **确实需要真窗口**（人工操作页面）→ `RECRUIT_BROWSER_HIDDEN=false liepin <cmd>`
  或 `LIEPIN_HEADLESS=false liepin <cmd>`
- **换了变量没变可见？** 端口上已有实例会被复用。先 `liepin quit`，下条命令才会按新模式重启
- **扫码登录不用管** → `liepin login` 会自己把无头实例关掉、以有头重启
- **释放内存** → `liepin quit`（登录态保留，下条命令自动重新拉起）
- **查在跑的是什么模式** → `curl http://127.0.0.1:53471/json/version`，UA 含 `HeadlessChrome` 即无头

## 环境要求

- Node.js ≥ 20
- Chrome/Edge 浏览器
- Windows / macOS / Linux 常见 Chrome/Edge 安装路径会自动检测；找不到浏览器时再设置 `CHROME_PATH`

## 常用命令

### 登录
```bash
# 首次使用需要登录
node /tmp/liepin-cli/dist/cli/index.js login
```

### 搜索人才
```bash
# 基础搜索
node /tmp/liepin-cli/dist/cli/index.js search 前端工程师

# 带筛选条件
node /tmp/liepin-cli/dist/cli/index.js search 前端工程师 --city 北京 --experience 3-5年 --salary 20-30K
```

### 查看简历
```bash
# 简历详情（简历ID = search 结果里的 resume_id）
node /tmp/liepin-cli/dist/cli/index.js resume <简历ID>
```

### 候选人管理
```bash
# 查看推荐候选人
node /tmp/liepin-cli/dist/cli/index.js recommend

# 查看人才库
node /tmp/liepin-cli/dist/cli/index.js talent

# 向候选人打招呼（resume_id/user_id 取 search/recommend 返回值；message 仅 resume_id 可用）
node /tmp/liepin-cli/dist/cli/index.js greet <resume_id> --ejobId <职位ID> --message "您好，方便发一份作品集看看吗？"
```

### 聊天管理
```bash
# 查看聊天列表
node /tmp/liepin-cli/dist/cli/index.js chatlist

# 查看与某候选人的聊天记录（对方imId = chatlist 结果里的 im_id）
node /tmp/liepin-cli/dist/cli/index.js chatmsg <对方imId>
```

## 命令参数

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `query` | 人才搜索关键词（必需） |
| | `--city` | 城市（如：北京、上海），按候选人**现居住地**过滤；期望城市看输出的 `want_city` |
| | `--experience` | 工作经验（如：3-5年） |
| | `--salary` | 薪资范围（如：20-30K） |
| | `--degree` | 学历（如：本科） |
| | `--user-status` | 求职状态，逗号多选：1离职找工作/2在职急寻/3在职暂不跳/4在校不找/5在校看机会/6在校可到岗/7离校找工作（如 `1,2,7`） |
| | `--age` | 年龄区间 `低,高`（如 `25,35`） |
| | `--page` | 页码 |
| | `--limit` | 返回条数 |
| `chatmsg` | `oppositeImId` | 对方 imId（chatlist 的 im_id，必需） |
| `resume` | `talentId` | 简历 ID（search 的 resume_id，必需） |
| `greet` | `usercId` | 候选人 resume_id 或 user_id（search/recommend 返回值，必需） |
| | `--ejobId` | 关联职位 ID（建议传，用于权限校验与归属） |
| | `--message` | 自定义消息（传 resume_id 时可用） |

## 防风控节奏（批量操作必须遵守）

猎聘对密集、机械化的操作会弹出文字点选验证码，自动化无法识别，触发后只能人工处理。编排批量流程时严格遵守：

- **打招呼（greet）**：单个候选人之间随机间隔 **15-45 秒**；每批最多 **5 人**，批次之间间隔 **3-5 分钟**
- **搜索（search）**：CLI 内部翻页已带随机间隔，但不要在短时间内反复变换关键词连续搜索
- **失败即停**：任何命令连续失败 **2 次**立即停止，不要换参数继续试探——密集试错正是触发风控的主因
- **风控错误**：报错信息含「触发猎聘风控」「反爬虫挑战」「页面已被清空」时，停止全部自动化操作，提示用户在浏览器中手动完成验证后再继续
- **退出码可判别**：`1` 一般错误，`2` 登录态失效（先跑 `liepin login`），`3` 风控/安全异常（立即停止自动化）——编排脚本按退出码分支，不要解析报错文案

## 故障排除

### Chrome 未找到（自动检测失败时）
```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### 登录失败
1. 确保 Chrome 已安装
2. 检查网络连接
3. 尝试手动登录后再使用 CLI

### 提示「检测到您当前网络地址在境外」
猎聘封境外 IP。先关闭 VPN / 代理（含 Outline、Clash TUN 模式等整机隧道），或将
`*.liepin.com` 分流为直连后重跑命令。**不要**为了"防检测"挂代理——代理正是被封主因。

### 被检测为自动化
- 增加操作间隔
- 减少操作频率
- 页面被清空为 about:blank 是 0.2.4 之前版本的已知问题（加载期 Runtime 检测），升级即修复

## 项目位置

源代码：`https://github.com/Viy1204/liepin-cli`

## 相关命令

- `liepin help` - 显示帮助信息
- `liepin login` - 登录猎聘账号
- `liepin search` - 搜索人才
- `liepin resume` - 查看简历详情
- `liepin chatlist` - 查看聊天列表
- `liepin chatmsg` - 查看与某候选人的聊天记录
- `liepin recommend` - 查看推荐候选人
- `liepin talent` - 查看人才库
- `liepin joblist` - 查看职位列表
- `liepin greet` - 向候选人打招呼（支持 resume_id + 自定义消息）
- `liepin quit` - 关掉常驻浏览器（登录态保留）
