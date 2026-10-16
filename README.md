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
| 主动打招呼 | `liepin greet <resume_id> --ejobId <jobId> --message "您好，方便发作品集看看吗？"` |
| 索要手机号 / 简历 | `liepin request-phone <resume_id>` / `liepin request-resume <resume_id>` |
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
| `liepin greet <resume_id 或 user_id> [--ejobId <职位ID>] [--message <消息>]` | **主动打招呼**：发起沟通，传 `resume_id` 时可补发自定义消息 |
| `liepin request-phone <resume_id>` | 向候选人**索要手机号**（需先 `greet` 建会话） |
| `liepin request-resume <resume_id>` | 向候选人**索要简历**（需先 `greet` 建会话） |
| `liepin joblist` | 查看职位列表 |
| `liepin quit` | 关掉常驻的浏览器（登录态保留） |

完整用法与参数：`liepin help`

> `search --city` 按候选人**现居住地**过滤（对应猎聘搜索的"现居住地"条件）；候选人的期望城市在 JSON 输出的 `want_city` 字段。

**退出码**：`0` 成功；`1` 一般错误；`2` 登录态失效（先跑 `liepin login`）；`3` 触发风控/安全异常（立即停止自动化，人工在浏览器完成验证）。脚本和 Agent 按退出码分支即可，无需解析报错文案。

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

# 6. 主动打招呼（resume_id / user_id 来自 search / recommend / talent；ejobId 来自 joblist）
liepin greet <resume_id> --ejobId <jobId> --message "您好，方便发一份作品集看看吗？"

# 7. 会话建立后索要联系方式与简历（候选人同意后，手机号会出现在 chatmsg 输出里）
liepin request-phone <resume_id>
liepin request-resume <resume_id>
```

> `login` **默认复用现有登录态**：还有效就直接返回、不重启浏览器，也不用重新扫码。
> 确实要重来一遍用 `liepin login --force`。同一天反复重登会被猎聘判「行为异常」，
> 所以 24 小时内超过 3 次交互式登录会被拦下（同样可用 `--force` 放行）。

---

## 与 AI Agent 集成

liepin-cli 的每条命令都输出结构化纯文本，AI Agent 可直接解析并编排多步流程。

```bash
# Agent 调用示例
result=$(liepin search 前端工程师 --city 北京 --limit 5 --json)
echo "$result" | jq '.[0].title'
```

### Claude Code 集成（Agent Skills）

```bash
# 把 liepin-cli 注册为 Agent Skill
liepin skill install
```

卸载目前不支持子命令，手动删除目录即可：`rm -rf ~/.agents/skills/liepin-cli`。

安装后**默认复制到 `~/.agents/skills/liepin-cli/`**（Windows：`%USERPROFILE%\.agents\skills\liepin-cli`）。重启 Claude Code 后，在对话中说"用 liepin 搜前端"即可触发。

> 其他兼容 Agent（Codex、Pi、OpenCode、MiniMax Code、WorkBuddy、Cherry Studio）请参考各自文档的 skills 目录位置，复制同一份 `SKILL.md` 即可，无需改写。

---

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `CHROME_PATH` | Chrome/Edge 可执行文件路径；Windows / macOS / Linux 常见安装路径会自动检测 | - |
| `LIEPIN_USER_DATA_DIR` | 用户数据目录 | `~/.liepin-cli/user-data` |
| `LIEPIN_SCREENSHOT_DIR` | 截图目录 | `~/.liepin-cli/screenshots` |
| `RECRUIT_BROWSER_HIDDEN` | 招聘工具链共读的**统一覆盖**开关（boss-cli / liepin-cli / DSH 面板都认）；设 `true` 让窗口隐藏。不设时各 CLI 用自己的默认 | 不设（默认有头） |
| `LIEPIN_HEADLESS` | 本 CLI 专属覆盖项，优先级高于 `RECRUIT_BROWSER_HIDDEN` | 跟随上一行 |
| `LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT` | 固定 CDP 调试端口（浏览器跨命令常驻靠它） | `53471` |
| `LIEPIN_SPAWN_BREAKAWAY` | 仅 Windows：经 WMI 拉起浏览器，使其脱离调用方的 Job Object（AI Agent 后台任务里必需，见下方常见问题）。设 `false` 回退到普通 spawn | `true` |
| `LIEPIN_PROXY` | 代理服务器 | - |
| `LIEPIN_DEBUG` | 调试模式 | `false` |

### 浏览器默认可见，怎么把它藏起来？

**默认有头**（与 boss-cli 一致）。代价是有头窗口一启动就抢走键盘焦点，会打断你手上的事；
想藏起来：

```bash
RECRUIT_BROWSER_HIDDEN=true liepin recommend   # 共读开关，boss / liepin / 面板都认
LIEPIN_HEADLESS=true liepin recommend          # 只影响 liepin-cli，优先级更高
```

⚠️ **但先读下一节再决定要不要藏**——无头的 UA 会自报 `HeadlessChrome`。

注意：**换了变量不会让已经在跑的那只浏览器换模式**。端口上已有实例会被直接复用，得先
`liepin quit`，下条命令才会按新模式重启。

想看浏览器在做什么但不要窗口抢焦点，用 [recruiting-copilot](https://github.com/Viy1204/recruiting-copilot)
的 DSH「招聘浏览器」面板（默认折叠、默认只读，操作请走 CLI）。

#### 为什么默认有头（2026-09-21 翻的默认，此前是无头）

- **无头的 User-Agent 里带 `HeadlessChrome/<ver>`**，等于每个请求都自报「我是自动化工具」。
  本 CLI **刻意不覆盖 UA**（伪造的 UA 与 sec-ch-ua Client Hints、真实平台互相矛盾，本身
  就是更明显的指纹），所以这条没法靠改 UA 绕过。BOSS 侧正是踩了它：账号被限制 **web 端
  登录 24 小时**，页面文案写「系统检测到您的账号存在使用第三方招聘管理系统、插件、外挂、
  软件等辅助工具」；另一个团队用默认有头长期无事，AI 擅自改走无头之后当天封号。
- **2026-09-20 猎聘侧实测**：连续无头调用后账号被判「行为异常」，302 到
  `safe.liepin.com/.../captchaPage_PC`，业务接口开始静默拦截（第二种风控形态）。

⚠️ 这**不等于**已证明「无头是唯一成因」——调用频次、issue #21 的重登循环都可能有份。
但 UA 自报是确定存在的送分题，先摘掉。

2026-08-19 的 Chrome 151 测试曾观察到加载期 Runtime 状态与清页有关，`safeGoto` 因此在显式
导航期间临时关闭 Runtime。该历史结果不能保证 Chrome 新版本或自定义页面点击流程稳定；
有头模式也不保证不会清页，当前补充反馈见 [#23](https://github.com/Viy1204/liepin-cli/issues/23)。

`RECRUIT_BROWSER_HIDDEN` 的语义仍是**统一覆盖开关**而不是「提供默认值」：不设时两个 CLI
各用自己的默认（现在两家都是有头），显式设了才把两家拉平。

### 浏览器跨命令常驻

命令结束只断开 CDP，**不关浏览器**：下条命令直连同一只实例（同一登录态、同一标签），
省掉反复启动的开销，DSH 面板的镜像也才有东西可连。

跑完招聘想释放内存就 `liepin quit`。判断在跑的那只是什么模式：

```bash
curl http://127.0.0.1:53471/json/version   # User-Agent 含 HeadlessChrome 即无头
```

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

### 提示「检测到您当前网络地址在境外」

猎聘封境外 IP。**先关 VPN / 代理**（含 Outline、Clash TUN 模式这类整机隧道），或将
`*.liepin.com` 分流为直连，再重跑命令。用 VPN 期间即使能扫码登录，BFF 接口也会拦截。

### 页面被清空为 about:blank

遇到空白页立即停止自动化，保留浏览器与登录状态；不要自动重跑、刷新、反复退出或重登。
涉及打招呼或发消息时，结果记为**待核验**，人工核对聊天记录后再决定后续动作，不能把异常
当作发送失败后自动重发。CLI 检测到空白页时抛 `RiskControlError`，退出码为 `3`。

0.2.4 加入了显式导航的 `safeGoto` 处理，但不能称为空白问题已经根治。
[#23 的 2026-10-16 补充](https://github.com/Viy1204/liepin-cli/issues/23#issuecomment-6212675882)
报告 macOS / Chrome 155 / 修改版 0.2.7 的可见页面流程仍间歇清页，触发原因尚未确定。

#### 原生命令与自定义 controller 的支持边界

- 原版默认启动或连接固定端口的常驻有头浏览器；每条 CLI 命令建立连接，结束后断开连接、保留浏览器。
  这是实现支持的生命周期，不代表已在 macOS / Chrome 155 上验证任意自定义 UI 流程都稳定。
- 原版 `search` 必要时导航到 `/search`，再通过页面内业务请求读取结果；`resume` 在 LPT 页面内
  请求简历数据，不等同于点击推荐卡片、打开在线预览并关闭预览。
- 自定义 controller 的 `open-card-preview` 与 `mapping-search-once` 没有调用 `safeGoto`。
  回退 `safeGoto` 的本地改动可恢复原版契约，不能据此声称这两个分支已经修复。
- 单连接、重连和独立进程的静态 DOM 测试只验证控制器及停止顺序；没有平台脚本的本地页
  无法证明真实猎聘页面的触发原因。#23 两次日志均先清页再断连，不能归因于主动 disconnect。

#### #23 的下一步最小对照

当前无需恢复平台测试。先保留原 profile 和修改版，在独立安装目录准备未经修改的
`@viyzhu/liepin-cli@0.2.7`，记录 Node、Chrome、Puppeteer 的实际版本及安装文件哈希。
四份 package diff 中，`safeGoto` 不恢复 Runtime 是原版契约差异；扩展加载仅在启动新浏览器时
生效；聊天分页与简历 URL 读取未出现在这两个失败调用链上。不要把它们同时回滚后归因。

当账号持有人决定恢复验证时，按以下顺序逐步对照，任一步清页就停止：

1. 人工恢复页面后，仅连接现有可见浏览器并短暂停留，不做 DOM 读取、点击或额外诊断。
2. 若上一步稳定，单独加入一次正文读取；再单独加入一次打开预览，或一次搜索提交。
   只有首次提交稳定时才测第二次提交；每步只增加一种操作，不发送消息或招呼。
3. 在相同 Chrome / Node / Puppeteer 版本、同一登录状态下，另测原版只读 `search`，
   以及已获得合法简历 ID 的 `resume`。两者与 UI 预览是不同路径，结果分别记录，不能互代验收。

每步记录连接开始/完成、操作开始/完成、主框架导航和主动断开请求的 UTC 时间；仅保留 URL 的
origin/path，去掉 query/hash 和候选人标识。可在 Puppeteer 已有事件上监听 `framenavigated`，
但监听器只能说明导航发生，不能给出发起调用栈，也不能证明连接初始化未启用 Runtime。
原生 CLI 对照同样有诊断扰动，应记录自己的导航和业务请求差异。

不要为了定位而修改安全脚本、拦截空白导航或切换 Runtime 状态。若要用 `Debugger`、断点或
额外 CDP 域采集调用栈，另列为有扰动实验，不能与普通复现混作同一份证据。

### Windows：浏览器窗口自己关掉 + 每次启动弹「Chrome 未正确关闭」

0.2.6 起已修复（issue #21）。根因不在 CLI 的关闭逻辑，而在**进程归属**：从 AI Agent 的
后台任务里调用 CLI 时，宿主通常把整棵进程树放进一个 `KILL_ON_JOB_CLOSE` 的 Job Object，
而 `spawn({ detached: true })` 只是新建进程组、**逃不出 Job**——CLI 一结束，Chrome 就被
连带终止，于是窗口"自己关了"、profile 留下 `exit_type: Crashed`、下次启动弹恢复气泡。

现在 Windows 上改经 WMI `Win32_Process.Create` 拉起浏览器（进程归 WmiPrvSE，不在调用方
的 Job 里），并加 `--hide-crash-restore-bubble` 兜底。要回退到旧行为设 `LIEPIN_SPAWN_BREAKAWAY=false`。

顺带说明为什么它会连累登录：`_e_ld_auth_` / `XSRF-TOKEN` 都是会话 cookie（`is_persistent=0`），
浏览器进程一没就等于退出登录，于是又得重新扫码——而重新扫码以前每次都会再关一次浏览器。
这个自我强化的循环正是账号被判「行为异常」的主因，0.2.6 一并断掉了（见下一条）。

### 账号被猎聘判「行为异常」，弹安全验证

页面会被 302 到 `safe.liepin.com/.../captchaPage_PC`。此时**所有业务接口都被静默拦截**，
`resume` 这类命令只会收到一个没有任何说明的 `{"flag":0}`——那不是简历权益不足，是风控。

- 0.2.6 起 CLI 直接识别这两种形态并以**退出码 3** 立即失败，附「请勿重试」提示，
  不再让脚本误判成权限问题、也不再对着验证页干等到超时；
- 处理办法只有人工过验证：`liepin login`（会切出有头窗口），在窗口里点「点击验证」完成滑块；
- **不要反复重登**。`login` 默认复用现有会话，24 小时内超过 3 次交互式登录会被拦下。

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
