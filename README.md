# liepin-cli — 猎聘招聘者端自动化 CLI | 人才搜索 · 简历查看 · AI Agent 友好

[![npm version](https://img.shields.io/npm/v/@viyzhu/liepin-cli)](https://www.npmjs.com/package/@viyzhu/liepin-cli)
[![npm downloads](https://img.shields.io/npm/dm/@viyzhu/liepin-cli)](https://www.npmjs.com/package/@viyzhu/liepin-cli)
[![license: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Viy1204/liepin-cli)](https://github.com/Viy1204/liepin-cli)

**liepin-cli**（`@viyzhu/liepin-cli`）是开源的 **猎聘招聘者端（lpt.liepin.com）自动化命令行工具**。基于 Puppeteer / CDP 协议驱动本机 Chrome，把招聘者端的核心操作搬进终端：**人才搜索**、**简历查看**、**推荐 / 人才库管理**、**主动打招呼**、**聊天记录查看**、**职位管理**。

每条命令都设计为无状态、单步可重入，输出结构化文本；批量筛选、多步流程由调用方（脚本或 Claude / GPT / Gemini 等 AI Agent）循环编排，搭建半自动化招聘流水线。

```bash
npm install -g @viyzhu/liepin-cli
liepin help
```

---

## 为什么选择 liepin-cli？

| 场景 | 命令 |
| --- | --- |
| 猎聘人才搜索 | `liepin search 前端工程师` |
| 猎聘简历预览 | `liepin resume <简历ID>` |
| 猎聘候选人筛选 | `liepin recommend` / `liepin talent` |
| 主动打招呼 | `liepin greet <user_id> --ejobId <jobId>` |
| 聊天记录查看 | `liepin chatlist` / `liepin chatmsg <对方imId>` |
| AI Agent 集成 | 子进程调用，每条命令输出结构化文本，可直接被 Agent 解析 |
| 数据本地化 | 无中间层服务，cookie 与截图仅存在 `~/.liepin-cli/` |

### 不适用场景

- 仅做**公开页面**信息抓取（无需登录态）→ 用 web fetch / 通用爬虫更合适
- **Boss 直聘** 同类需求 → 走 [boss-cli](https://github.com/Viy1204/boss-cli)
- 投递后的**面试日程 / ATS 流转** → 那是 ATS / 招聘系统 skill 的事

---

## 安装

**要求**：Node.js ≥ 20，本机已安装 Chrome / Chromium。

```bash
npm install -g @viyzhu/liepin-cli
liepin help
```

> **macOS / Linux 全局安装权限问题**：系统 Node 默认全局前缀在 `/usr/local`，当前账户无写权限。建议先把全局前缀挪到用户目录（一次性配置）：
>
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix ~/.npm-global
> # macOS 默认 shell 是 zsh
> echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
> # macOS bash / Linux
> echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
> source ~/.zshrc  # 或 source ~/.bashrc
> ```
>
> 使用 `fnm` / `nvm` / `volta` 的用户可跳过此步。Windows 用户无需此步。
>
> **Windows / Linux 找不到 Chrome**：自动探测覆盖 Chrome / Edge 的常见安装路径，
> 若未命中请手动设置 `CHROME_PATH`（见下方「环境变量」）。

---

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `liepin search <关键词>` | 搜索人才 |
| `liepin chatlist` | 查看聊天列表 |
| `liepin chatmsg <对方imId>` | 查看与某候选人的聊天记录 |
| `liepin recommend` | 查看推荐候选人 |
| `liepin talent` | 查看人才库 |
| `liepin resume <简历ID>` | 查看简历详情（传 search / recommend / talent 返回的 resume_id） |
| `liepin greet <user_id> [--ejobId <职位ID>]` | **主动打招呼**：向候选人发站内信，使用该职位预设的招呼语 |
| `liepin joblist` | 查看职位列表 |

完整用法与参数：`liepin help`

---

## 快速上手

```bash
# 1. 登录招聘者端（弹出浏览器扫码，cookie 本地持久化）
liepin login

# 2. 搜索人才
liepin search 前端工程师 --city 北京 --experience 3-5年

# 3. 查看某候选人简历（resume_id 来自 search / recommend / talent 结果）
liepin resume <简历ID>

# 4. 查看推荐候选人
liepin recommend

# 5. 查看聊天列表 / 某会话记录（im_id 来自 chatlist）
liepin chatlist
liepin chatmsg <对方imId>

# 6. 主动打招呼（user_id 来自 search / recommend / talent；ejobId 来自 joblist）
liepin greet <user_id> --ejobId <jobId>
```

---

## 与 AI Agent 集成

liepin-cli 的每条命令都输出结构化纯文本，AI Agent 可直接解析并编排多步流程。

```bash
# Agent 调用示例
result=$(liepin search 前端工程师 --city 北京 --limit 5)
echo "$result" | jq '.[0].title'
```

### Claude Code 集成（Agent Skills）

```bash
# 把 liepin-cli 注册为 Agent Skill
liepin skill install

# 卸载
liepin skill uninstall
```

安装后**默认复制到 `~/.agents/skills/liepin-cli/`**（Windows：`%USERPROFILE%\.agents\skills\liepin-cli`）。重启 Claude Code 后，在对话中说"用 liepin 搜前端"即可触发。

> 其他兼容 Agent（Codex、Pi、OpenCode、MiniMax Code、WorkBuddy、Cherry Studio）请参考各自文档的 skills 目录位置，复制同一份 `SKILL.md` 即可，无需改写。

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
3. 命令报"返回了 HTML / 反爬挑战"多为登录态过期，重新 `liepin login` 即可

### 被检测为自动化

如频繁被风控拦截，请开 issue 带上 `liepin --debug` 输出，maintainer 协助排查。

---

## 开发

```bash
git clone https://github.com/Viy1204/liepin-cli.git
cd liepin-cli
npm install
npm run build && npm test
```

发版：在 `main` 上 `npm version patch`（自动 bump + 打 tag）后 `git push --tags`，GitHub Actions 经 **npm Trusted Publishing (OIDC)** 自动发布，无需 npm token（见 `.github/workflows/publish.yml`）。

---

## 许可证

GPL-3.0，详见 [LICENSE](./LICENSE)。

---

## 相关项目

- [boss-cli](https://github.com/Viy1204/boss-cli) — Boss 直聘自动化 CLI
- [opencli](https://github.com/jackwener/opencli) — 开源 CLI 框架
