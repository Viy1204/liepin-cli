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
| | `--city` | 城市（如：北京、上海） |
| | `--experience` | 工作经验（如：3-5年） |
| | `--salary` | 薪资范围（如：20-30K） |
| | `--degree` | 学历（如：本科） |
| | `--page` | 页码 |
| | `--limit` | 返回条数 |
| `chatmsg` | `oppositeImId` | 对方 imId（chatlist 的 im_id，必需） |
| `resume` | `talentId` | 简历 ID（search 的 resume_id，必需） |
| `greet` | `usercId` | 候选人 resume_id 或 user_id（search/recommend 返回值，必需） |
| | `--ejobId` | 关联职位 ID（建议传，用于权限校验与归属） |
| | `--message` | 自定义消息（传 resume_id 时可用） |

## 故障排除

### Chrome 未找到（自动检测失败时）
```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### 登录失败
1. 确保 Chrome 已安装
2. 检查网络连接
3. 尝试手动登录后再使用 CLI

### 被检测为自动化
- 增加操作间隔
- 使用代理
- 减少操作频率

## 项目位置

源代码：`/tmp/liepin-cli/`

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
