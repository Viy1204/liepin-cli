---
name: liepin-cli
description: >-
  猎聘自动化 CLI 工具。当用户提到猎聘、liepin、招聘自动化、候选人管理、
  人才搜索、自动打招呼等功能时，使用此 skill。
---

# 猎聘 CLI (`liepin-cli`)

## 功能概述

liepin-cli 是猎聘自动化命令行工具，支持：
- 人才搜索和筛选
- 候选人管理
- 自动打招呼
- 聊天消息管理
- 人才库浏览

## 环境要求

- Node.js ≥ 20
- Chrome/Edge 浏览器
- macOS 常见 Chrome/Edge 安装路径会自动检测；找不到浏览器时再设置 `CHROME_PATH`

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

### 查看详情
```bash
# 职位详情
node /tmp/liepin-cli/dist/cli/index.js detail <职位ID>

# 公司信息
node /tmp/liepin-cli/dist/cli/index.js company <公司ID>
```

### 候选人管理
```bash
# 查看推荐候选人
node /tmp/liepin-cli/dist/cli/index.js recommend

# 查看人才库
node /tmp/liepin-cli/dist/cli/index.js talent

# 向候选人打招呼
node /tmp/liepin-cli/dist/cli/index.js greet <人才ID>
```

### 聊天管理
```bash
# 查看聊天列表
node /tmp/liepin-cli/dist/cli/index.js chatlist

# 查看聊天消息
node /tmp/liepin-cli/dist/cli/index.js chatmsg <聊天ID>
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
| `detail` | `jobId` | 职位 ID（必需） |
| `company` | `companyId` | 公司 ID（必需） |
| `chatmsg` | `chatId` | 聊天 ID（必需） |
| `greet` | `talentId` | 人才 ID（必需） |
| | `--message` | 打招呼消息 |
| `resume` | `talentId` | 人才 ID（必需） |

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
- `liepin detail` - 查看职位详情
- `liepin company` - 查看公司信息
- `liepin chatlist` - 查看聊天列表
- `liepin chatmsg` - 查看聊天消息
- `liepin recommend` - 查看推荐候选人
- `liepin talent` - 查看人才库
- `liepin resume` - 查看简历详情
- `liepin greet` - 向候选人打招呼
- `liepin joblist` - 查看职位列表
