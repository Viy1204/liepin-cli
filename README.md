# liepin-cli — 猎聘招聘者端自动化 CLI | 人才搜索 · 简历查看 · AI Agent 招聘工具

[![npm version](https://img.shields.io/npm/v/@viyzhu/liepin-cli)](https://www.npmjs.com/package/@viyzhu/liepin-cli)
[![npm downloads](https://img.shields.io/npm/dm/@viyzhu/liepin-cli)](https://www.npmjs.com/package/@viyzhu/liepin-cli)
[![license](https://img.shields.io/github/license/Viy1204/liepin-cli)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Viy1204/liepin-cli)](https://github.com/Viy1204/liepin-cli)

**liepin-cli**（`@viyzhu/liepin-cli`）是开源的 **猎聘招聘者端（lpt.liepin.com）自动化命令行工具**。基于 Puppeteer / CDP 协议驱动本机 Chrome，无需 Selenium，把招聘者端的核心操作搬进终端：**人才搜索**、**简历查看**、**推荐 / 投递候选人管理**、**聊天记录查看**、**职位管理**。

每条命令都是单步原子操作，输出结构化文本；批量筛选、多步流程由调用方（脚本或 Claude / GPT / Gemini 等 **AI Agent**）循环编排，搭建半自动化招聘流水线。

```bash
npm install -g @viyzhu/liepin-cli@latest
liepin help
```

> 纯 CLI，不内置对话式 Agent。每条命令输出结构化纯文本，Agent 可直接解析并编排多步流程。

---

## 为什么选择 liepin-cli？

| 场景 | 命令 |
| --- | --- |
| 猎聘人才搜索 | `liepin search 前端工程师` |
| 猎聘简历预览 | `liepin resume <简历ID>` |
| 猎聘候选人筛选 | `liepin recommend` / `liepin talent` |
| 猎聘脚本自动化 | 本机 Chrome + CDP，Cookie 本地存储 |
| AI 招聘 Agent | 子进程调用，输出 Agent 友好 |
| 数据隐私 | 不经过第三方服务器，数据在 `~/.liepin-cli/` |

---

## 安装

**要求**：Node.js ≥ 20，本机已安装 Chrome / Chromium。

```bash
npm install -g @viyzhu/liepin-cli@latest
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
>
> **Windows / Linux 找不到 Chrome**：自动探测覆盖 Chrome / Edge 的常见安装路径，
> 若未命中请手动设置 `CHROME_PATH`（见下方「环境变量」）。

### 从源码构建

```bash
git clone https://github.com/Viy1204/liepin-cli.git
cd liepin-cli
npm install && npm run build
```

---

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `liepin search <关键词>` | 搜索人才 |
| `liepin chatlist` | 查看聊天列表 |
| `liepin chatmsg <对方imId>` | 查看与某候选人的聊天记录 |
| `liepin recommend` | 查看推荐候选人 |
| `liepin talent` | 查看人才库 |
| `liepin resume <简历ID>` | 查看简历详情（传 search 返回的 resume_id） |
| `liepin greet <人才ID>` | 向候选人打招呼（⚠️ 未验证，端点可能已失效） |
| `liepin joblist` | 查看职位列表 |

完整用法：`liepin help`

---

## 快速上手

```bash
# 1. 登录招聘者端（弹出浏览器扫码，cookie 本地持久化）
liepin login

# 2. 搜索人才
liepin search 前端工程师 --city 北京 --experience 3-5年

# 3. 查看某候选人简历（resume_id 来自 search 结果）
liepin resume <简历ID>

# 4. 查看推荐候选人
liepin recommend

# 5. 查看聊天列表 / 某会话记录（im_id 来自 chatlist）
liepin chatlist
liepin chatmsg <对方imId>
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
> 使用 liepin-cli 搜索前端工程师候选人
> 用 liepin-cli 看看排第一的候选人简历
```

---

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `CHROME_PATH` | Chrome/Edge 可执行文件路径；Windows / macOS / Linux 常见安装路径会自动检测 | - |
| `LIEPIN_USER_DATA_DIR` | 用户数据目录 | `~/.liepin-cli/user-data` |
| `LIEPIN_SCREENSHOT_DIR` | 截图目录 | `~/.liepin-cli/screenshots` |
| `LIEPIN_HEADLESS` | 是否无头模式 | `false` |
| `LIEPIN_PROXY` | 代理服务器 | - |
| `LIEPIN_DEBUG` | 调试模式 | `false` |

---

## 常见问题

### Chrome 未找到（自动探测失败时手动指定）

```bash
# macOS
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Linux
export CHROME_PATH="/usr/bin/google-chrome"
# Windows (PowerShell)
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

### 登录失败 / 登录态失效

1. 重新跑 `liepin login`，在弹出的浏览器里扫码登录招聘者端
2. 确认 `LIEPIN_USER_DATA_DIR` 目录正确（cookie 持久化在此）
3. 命令报“返回了 HTML / 反爬挑战”多为登录态过期，重新 `liepin login` 即可

### 被检测为自动化

1. 增加随机延迟
2. 检查 User-Agent
3. 使用代理
4. 减少操作频率

---

## 开发

```bash
npm install
npm run build && npm test
```

发版：在 `main` 上 `npm version patch`（自动 bump + 打 tag）后 `git push --tags`，GitHub Actions 经 **npm Trusted Publishing (OIDC)** 自动发布，无需 npm token（见 `.github/workflows/publish.yml`）。

---

## 许可证

GPL-3.0

---

## 相关项目

- [boss-cli](https://github.com/viy/boss-cli) - Boss直聘自动化 CLI
- [opencli](https://github.com/jackwener/opencli) - 开源 CLI 框架
