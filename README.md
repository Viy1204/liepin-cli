# liepin-cli — 猎聘自动化 CLI | 批量发消息 · 自动打招呼 · AI Agent 招聘工具

[![npm version](https://img.shields.io/npm/v/@viy/liepin-cli)](https://www.npmjs.com/package/@viy/liepin-cli)
[![npm downloads](https://img.shields.io/npm/dm/@viy/liepin-cli)](https://www.npmjs.com/package/@viy/liepin-cli)
[![license](https://img.shields.io/github/license/viy/liepin-cli)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/viy/liepin-cli)](https://github.com/viy/liepin-cli)

**liepin-cli**（`@viy/liepin-cli`）是开源的 **猎聘自动化命令行工具**。基于 Puppeteer / CDP 协议驱动本机 Chrome，无需 Selenium，把猎聘的核心 HR 操作搬进终端：**职位搜索**、**候选人管理**、**批量发消息**、**自动打招呼**、**简历预览**、**人才库管理**。

适合 HR 日常提效，也适合 Claude / GPT / Gemini 等 **AI Agent** 通过子进程调用，搭建全自动化招聘流水线。

```bash
npm install -g @viy/liepin-cli@latest
liepin help
```

> 纯 CLI，不内置对话式 Agent。每条命令输出结构化纯文本，Agent 可直接解析并编排多步流程。

---

## 为什么选择 liepin-cli？

| 场景 | 命令 |
| --- | --- |
| 猎聘职位搜索 | `liepin search 前端工程师` |
| 猎聘自动打招呼 | `liepin greet <人才ID>` |
| 猎聘候选人筛选 | `liepin recommend` / `liepin talent` |
| 猎聘脚本自动化 | 本机 Chrome + CDP，Cookie 本地存储 |
| AI 招聘 Agent | 子进程调用，输出 Agent 友好 |
| 数据隐私 | 不经过第三方服务器，数据在 `~/.liepin-cli/` |

---

## 安装

**要求**：Node.js ≥ 20，本机已安装 Chrome / Chromium。

```bash
npm install -g @viy/liepin-cli@latest
liepin help
```

> **macOS / Linux 权限问题**：系统 Node 默认全局前缀在 `/usr/local`，当前账户无写权限。建议先把全局前缀挪到用户目录（一次性配置）：
>
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix ~/.npm-global
> echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc   # bash 用 ~/.bash_profile
> source ~/.zshrc
> ```
>
> 使用 `fnm` / `nvm` / `volta` 的用户可跳过此步。Windows 用户无需此步。

### 从源码构建

```bash
git clone https://github.com/viy/liepin-cli.git
cd liepin-cli
npm install && npm run build
```

---

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `liepin search <关键词>` | 搜索职位 |
| `liepin detail <职位ID>` | 查看职位详情 |
| `liepin company <公司ID>` | 查看公司信息 |
| `liepin chatlist` | 查看聊天列表 |
| `liepin chatmsg <聊天ID>` | 查看聊天消息 |
| `liepin recommend` | 查看推荐候选人 |
| `liepin talent` | 查看人才库 |
| `liepin resume <人才ID>` | 查看简历详情 |
| `liepin greet <人才ID>` | 向候选人打招呼 |
| `liepin joblist` | 查看职位列表 |

完整用法：`liepin help`

---

## 快速上手

```bash
# 1. 登录（首次使用会打开浏览器）
liepin search 前端工程师

# 2. 搜索职位
liepin search 前端工程师 --city 北京 --experience 3-5年

# 3. 查看职位详情
liepin detail 123456

# 4. 查看推荐候选人
liepin recommend

# 5. 向候选人打招呼
liepin greet 789012
```

---

## 与 AI Agent 集成

liepin-cli 的每条命令都输出结构化纯文本，AI Agent 可直接解析并编排多步流程。

```bash
# Agent 调用示例
result=$(liepin search 前端工程师 --city 北京 --limit 5)
echo "$result" | jq '.[0].title'
```

### Claude Code 集成

```bash
# 安装 skill
liepin skill install

# 在 Claude Code 中使用
> 使用 liepin-cli 搜索前端工程师职位
> 使用 liepin-cli 向候选人打招呼
```

---

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `CHROME_PATH` | Chrome/Edge 可执行文件路径 | - |
| `LIEPIN_USER_DATA_DIR` | 用户数据目录 | `~/.liepin-cli/user-data` |
| `LIEPIN_SCREENSHOT_DIR` | 截图目录 | `~/.liepin-cli/screenshots` |
| `LIEPIN_HEADLESS` | 是否无头模式 | `false` |
| `LIEPIN_PROXY` | 代理服务器 | - |
| `LIEPIN_DEBUG` | 调试模式 | `false` |

---

## 常见问题

### Chrome 未找到

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### 登录失败

1. 先手动登录猎聘网站
2. 确保 `LIEPIN_USER_DATA_DIR` 目录正确
3. 检查 Cookie 是否过期

### 被检测为自动化

1. 增加随机延迟
2. 检查 User-Agent
3. 使用代理
4. 减少操作频率

---

## 许可证

GPL-3.0

---

## 相关项目

- [boss-cli](https://github.com/viy/boss-cli) - Boss直聘自动化 CLI
- [opencli](https://github.com/jackwener/opencli) - 开源 CLI 框架
