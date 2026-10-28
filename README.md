# liepin-cli

[![npm version](https://img.shields.io/npm/v/@viyzhu/liepin-cli)](https://www.npmjs.com/package/@viyzhu/liepin-cli)
[![npm downloads](https://img.shields.io/npm/dm/@viyzhu/liepin-cli)](https://www.npmjs.com/package/@viyzhu/liepin-cli)
[![license: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](./LICENSE)

liepin-cli 把猎聘招聘者端（[lpt.liepin.com](https://lpt.liepin.com/)）的操作提供为命令行命令。你可以搜索人才、读取简历、查看推荐与投递候选人、查询职位和聊天记录，也可以在确认后打招呼、发送自定义文本或索要联系方式。

CLI 通过 Puppeteer/CDP 连接本机 Chrome、Edge 或 Chromium，使用独立的浏览器资料目录。查询结果默认显示为表格或字段文本，加 `--json` 可供脚本和 AI Agent 读取。多候选人循环、筛选判断和招聘进度记录由调用方组织。

本项目由 [Viy1204](https://github.com/Viy1204) 维护，可独立使用，也可配合以下项目。

| 项目 | 分工 |
| --- | --- |
| [recruiting-copilot](https://github.com/Viy1204/recruiting-copilot) | 提供岗位梳理、寻源初筛、台账日报和面试安排的 Skill 流程，并展示招聘进展看板 |
| [Viy1204/boss-cli](https://github.com/Viy1204/boss-cli) | BOSS 直聘 CLI fork，负责 BOSS 平台操作 |
| 本项目 | 负责猎聘招聘者端操作，账号、权限和浏览器登录态与 BOSS 分开 |

## 安装与首次查询

需要以下环境。

- Node.js ≥ 20，建议使用仍受支持的 LTS 版本。仓库 CI 覆盖 Node.js 20、22 和 24。
- 本机已安装 Chrome、Edge 或 Chromium。CLI 使用 `puppeteer-core`，不会替你下载浏览器。
- 能正常登录猎聘招聘者端的账号。可读取的资料、沟通次数与联系方式取决于账号权限和候选人授权。

本文对应 `0.2.10`：推荐结果的 `resume_id`、简历年月及触达确认修复见[发布说明](https://github.com/Viy1204/liepin-cli/blob/v0.2.10/docs/releases/v0.2.10.md)，不包含在 `0.2.9` 中。此前的页面会话和聊天简历标识变化见 [v0.2.9 发布说明](https://github.com/Viy1204/liepin-cli/blob/v0.2.9/docs/releases/v0.2.9.md)。示例中的 `<resume_id>`、`<im_id>` 和 `<jobId>` 要替换为查询结果中的实际值。

### 1. 安装 CLI

```bash
npm install -g @viyzhu/liepin-cli
```

npm 包名是 `@viyzhu/liepin-cli`，安装后的命令名是 `liepin`。检查版本，应输出 `liepin-cli v<版本号>`。

```bash
liepin --version
```

查看帮助，确认能看到 `login`、`search`、`resume` 等命令。

```bash
liepin --help
```

macOS 或 Linux 如遇全局安装权限错误，可用 fnm、nvm 或 Volta 管理 Node.js，再安装 CLI。找不到浏览器时，按[浏览器配置](#浏览器配置)设置 `CHROME_PATH`。

### 2. 登录招聘者端

```bash
liepin login
```

CLI 打开可见的浏览器窗口，等待你扫码或输入账号密码，默认等待 120 秒。看到“登录成功”或“登录态仍然有效”后，再执行查询。需要更长的人工操作窗口时使用 `liepin login --timeout 300`。

`login` 会先检查现有会话，仍有效时直接复用。CLI 默认限制 24 小时内最多 3 次交互式登录。`login --force` 会跳过会话复用和这项本地限制，只有人工确认确需重新登录时才使用。

### 3. 搜索并读取一份简历

搜索一批候选人。

```bash
liepin search "前端工程师" --city 北京 --experience 3-5年 --limit 5 --json
```

从结果数组中选择一人，将其 `resume_id` 复制到下面的命令。

```bash
liepin resume "<resume_id>" --json
```

简历结果包含工作经历、教育经历、求职意向等字段；缺失字段可能为空。`work_history` 和 `education_history` 是多行字符串，保留接口提供的起止年月与时长，工作职位优先使用名称文本。顶层 `education` 来自首条教育经历，不包含院校或培养形式，不能替代完整教育经历核验。

`search --city` 按候选人现居住地过滤，期望城市另见结果中的 `want_city`。加 `--json` 能读到表格中未显示的标识符和字段。

### 4. 查看职位、推荐和投递候选人

先查看职位列表，取得 `jobId`。

```bash
liepin joblist --json
```

用该职位查看推荐候选人。`recommend` 需要可用职位，不传 `--jobId` 时使用推荐页当前职位。

```bash
liepin recommend --jobId "<jobId>" --limit 5 --json
```

查看投递到你的职位的候选人列表。

```bash
liepin talent --limit 5 --json
```

不同列表的字段名尚未统一，传给下一条命令前按下表取值。

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `resume_id` | `search`、`recommend`、`talent`，或 `chatmsg --resolve-resume` | 传给 `resume`、`greet`、`request-phone` 或 `request-resume`；推荐结果从 URL 的 `resIdEncode` 提取 |
| `talentId` | `recommend` | 推荐记录的原始标识，保留以兼容旧输出；不能代替 `resume_id` |
| `user_id` | `search`、`recommend`、`talent`、`chatlist` | 传给 `greet` 发起默认沟通；不能代替 `chatmsg` 的参数 |
| `im_id` | `chatlist` | 对方的 IM 标识，传给 `chatmsg` |
| `jobId` | `joblist` | 传给 `recommend --jobId` 或 `greet --ejobId` |

### 5. 查看已有会话

查看最近一批会话。

```bash
liepin chatlist --limit 20 --json
```

使用结果中的 `im_id` 查看该会话的消息。

```bash
liepin chatmsg "<im_id>" --limit 50 --json
```

`chatmsg` 返回当前取到的消息，按旧到新排列。它读取最近一批消息，最多 100 条，不会自动翻完全部历史记录。消息卡片包含手机号时，`chatmsg` 也会输出该号码。

`0.2.9` 起，简历卡片中的历史标识单独输出为 `card_resume_id`。需要获取能传给 `resume` 的当前简历 ID 时，可显式开启解析：

```bash
liepin chatmsg "<im_id>" --resolve-resume --json
```

该选项默认关闭；开启后要求本批消息中有属于目标候选人的简历卡片，并增加一次只读请求，成功时输出 `resume_id`。缺少卡片、卡片缺少 `userId` 或同一会话的标识不一致时直接报错，不回退使用历史 ID。

## 发起沟通前先确认

`greet`、`request-phone` 和 `request-resume` 会对候选人产生实际动作。执行前确认候选人、关联职位和要发送的内容；由脚本或 Agent 调用时，先取得用户对相应动作的授权。CLI 不会再弹出人工审批提示。

根据已确认的动作选择执行。仅使用职位预设招呼语时运行下面的命令。

```bash
liepin greet "<resume_id>" --ejobId "<jobId>" --json
```

需要补发自定义文本时，改用带 `--message` 的命令，自定义文本必须使用简历 ID。

```bash
liepin greet "<resume_id>" --ejobId "<jobId>" --message "您好，想与您沟通这个职位，方便了解一下吗？" --json
```

已有会话且获准索要手机号时，执行下面的命令。

```bash
liepin request-phone "<resume_id>" --json
```

已有会话且获准索要简历时，执行下面的命令。

```bash
liepin request-resume "<resume_id>" --json
```

`greet` 遇到已有会话会跳过建立会话，没有 `--message` 时明确返回「本次未发送新消息」；传了 `--message` 仍会尝试发送文本，重复执行可能重复发消息。只有 `user_id` 时只能发起默认沟通，搭配 `--message` 会在页面操作前报错。

`greet` 与索要命令均用 `confirmed` 区分操作完成和发送确认：只有本次新增且匹配的我方消息才算确认，旧同文、无关来信或按钮变灰都不算。缺少 IM 标识、默认开聊只得到接口成功或未观察到新消息时，返回 `confirmed: false`，需要人工核对；`success: true` 不能替代发送确认。新开聊同时补发自定义消息时，预设招呼可能延迟出现，无法可靠归属两次发送，因此也保守返回未确认；已有会话的自定义文本可按新消息核验。

索要操作依赖会话中的快捷按钮。索要简历命令发送的是请求，不会自动下载候选人的简历附件。直接读取已有简历使用 `resume`，无需先打招呼或索要。

任何发送动作遇到空白页、断连或未确认结果，都先记为待核验。人工核对聊天记录后再决定后续动作，不要自动重发。

## 命令与参数参考

`liepin help`、`liepin --help` 和 `liepin <命令> --help` 当前都显示全局帮助。常用参数如下，参数名区分大小写。

| 命令 | 常用参数 | 说明 |
| --- | --- | --- |
| `login` | `--timeout 120`、`--force` | 人工登录或复用现有会话 |
| `search "关键词"` | `--city`、`--experience`、`--salary`、`--degree`、`--industry`、`--user-status`、`--age`、`--page`、`--limit` | 搜索人才，默认第 1 页、20 条 |
| `resume "<简历ID>"` | 也可用 `--talentId "<resume_id>"` | 值须为 resIdEncode；没有 `--resume-id` 别名，受账号查看权限限制 |
| `recommend` | `--jobId`、`--limit` | 查看某职位的推荐候选人，默认最多 20 条，单次最多 40 条 |
| `talent` | `--query "姓名"`、`--page`、`--limit` | 查看投递候选人，默认第 1 页、20 条，单页最多 40 条 |
| `joblist` | `--status 招聘中`、`--page`、`--limit` | 查看职位；状态筛选作用于本次取得的一页，单页最多 40 条 |
| `chatlist` | `--limit 30` | 查看最近一批会话 |
| `chatmsg "<im_id>"` | `--limit 50`、`--resolve-resume` | 查看最近一批消息，最多 100 条；可显式解析当前简历 ID |
| `greet "<简历ID或user_id>"` | `--ejobId`、`--jobId`、`--message` | `--jobId` 是 `--ejobId` 的别名；自定义消息只支持简历 ID |
| `request-phone "<简历ID>"` | 无命令专属选项 | 向已有会话的候选人索要手机号 |
| `request-resume "<简历ID>"` | 无命令专属选项 | 向已有会话的候选人索要简历 |
| `skill install` | 无命令专属选项 | 复制随包提供的 Agent Skill，不启动浏览器 |
| `quit` | 无命令专属选项 | 关闭常驻浏览器，保留资料目录 |

搜索筛选的取值如下。

| 参数 | 示例与含义 |
| --- | --- |
| `--city` | `北京`、`杭州` 或城市代码，默认全国，按现居住地过滤 |
| `--experience` | `应届`、`1-3年`、`3-5年`、`5-10年`、`10年以上` |
| `--salary` | 月薪范围：`3K以下`、`3-5K`、`5-10K`、`10-15K`、`15-20K`、`20-30K`、`30-50K`、`50K以上` |
| `--degree` | `大专`、`本科`、`硕士`、`博士` |
| `--industry` | 行业名称或代码，如 `互联网`、`金融` |
| `--user-status` | 逗号多选，如 `1,2,7`。1 离职找工作，2 在职急寻，3 在职暂不跳，4 在校不找，5 在校看机会，6 在校可到岗，7 离校找工作 |
| `--age` | `25,35`，格式为 `低,高` |
| `--page` | 起始页码，从 1 开始 |
| `--limit` | 返回条数，默认 20。`search` 会按需继续翻页，达到条数、没有结果或内部翻页上限时停止 |

`--salary` 未识别时会按不限薪资查询。工作经验和学历按表中的写法填写，CLI 不校验所有筛选值。`--user-status` 和 `--age` 格式错误则直接报参数错误。

部分已声明参数尚未接入请求：`recommend` 的 `--jobTitle`、`--page`，以及 `talent` 的 `--salary`、`--degree` 当前不生效。`talent --city` 直接使用城市代码，`talent --experience` 使用 `3-5` 这样的数字范围，不能照搬 `search` 的全部筛选写法。

### 输出与退出码

查询命令加 `--json` 后，标准输出为 JSON 数组或对象，错误信息写入标准错误。建议把 `--json` 放在命令末尾。

`chatmsg --json` 保留自 `0.2.8` 起的消息来源字段 `source`，可区分 `chat`、`exchange_request`、`exchange_result`、`system` 和 `unknown`；`ext_type`、`biz_type`、`biz_key` 保留协议字段。来源根据协议字段判断，不按消息正文猜测。

`login --json` 仍会输出进度文本，不能直接把整段标准输出当作 JSON 解析。登录超时、登录频率限制或请求按钮不可用时，命令可能以退出码 `0` 返回 `success: false`，调用方还需检查结果字段。

| 退出码 | 含义 | 后续处理 |
| --- | --- | --- |
| `0` | 命令正常返回 | 对动作结果继续检查 `success`、`confirmed` 等字段 |
| `1` | 参数、权限、网络等一般错误 | 检查具体错误，不盲目重复发送动作 |
| `2` | 登录态失效 | 人工通过 `liepin login` 恢复登录 |
| `3` | 风控、安全验证或页面失效 | 停止自动化，按[故障处理](#故障处理)人工核验 |

## 接入 AI Agent

在终端完成 CLI 安装和登录后，可安装随包提供的 Skill。

```bash
liepin skill install
```

默认目标是 `~/.claude/skills/liepin-cli/`，Windows 对应 `%USERPROFILE%\.claude\skills\liepin-cli\`。新开 Claude Code 会话后，可让 Agent 按该 Skill 调用 CLI。CLI 升级后，重新执行安装命令可同步 Skill 文件。

随包 Skill 的示例命令使用源码目录路径 `node /tmp/liepin-cli/dist/cli/index.js`。全局安装的用户需要让 Agent 改用 `liepin` 命令，或把示例路径替换为实际安装位置；直接照抄示例路径会找不到 CLI。

其他支持 Agent Skills 的工具，按各自文档选择技能目录，通过环境变量 `LIEPIN_SKILL_TARGET_DIR` 指定完整目标目录后再安装。当前只支持安装，卸载时手动删除已安装的 `liepin-cli` 技能目录。

需要组织岗位要求、候选人评估、台账和每日招聘流程时，使用 [recruiting-copilot 的安装与初始化说明](https://github.com/Viy1204/recruiting-copilot)。平台命令仍由 liepin-cli 执行，外发操作仍需要用户授权。

## 浏览器配置

浏览器默认可见，首次执行平台命令时启动，命令结束只断开连接。后续命令复用固定端口上的同一浏览器。运行 `liepin quit` 才会主动关闭它。

资料目录会保留，但会话 Cookie 可能在浏览器关闭后失效，因此不能保证 `quit` 后仍保持登录。后续若遇退出码 `2`，再执行 `liepin login`。

CLI 自动检查 Windows、macOS 和 Linux 的常见安装路径。未找到浏览器时，设置可执行文件路径。

macOS 使用下面的命令。

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Linux 根据安装位置设置路径。

```bash
export CHROME_PATH="/usr/bin/google-chrome"
```

Windows PowerShell 使用下面的命令。

```powershell
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

可用环境变量如下。

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `CHROME_PATH` | 浏览器可执行文件路径，优先于 `PUPPETEER_EXECUTABLE_PATH` | 自动检测 |
| `PUPPETEER_EXECUTABLE_PATH` | 浏览器可执行文件路径的备选配置 | 自动检测 |
| `LIEPIN_USER_DATA_DIR` | 猎聘独立浏览器资料目录 | `~/.liepin-cli/user-data` |
| `LIEPIN_CONFIG_DIR` | 配置与交互式登录历史目录 | `~/.liepin-cli` |
| `LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT` | 常驻浏览器的调试端口 | `53471` |
| `RECRUIT_BROWSER_HIDDEN` | 招聘工具链共享的隐藏窗口开关，`true` 使用无头模式 | 未设置，使用可见窗口 |
| `LIEPIN_HEADLESS` | liepin-cli 专属开关，优先于上一项 | 跟随上一项 |
| `LIEPIN_SPAWN_BREAKAWAY` | Windows 默认尝试经 WMI 启动浏览器，使其不随调用方进程退出；`false` 使用普通启动方式 | `true` |
| `LIEPIN_PROXY` | 浏览器代理服务器 | 未设置 |
| `LIEPIN_SKILL_TARGET_DIR` | Skill 安装目标目录 | `~/.claude/skills/liepin-cli` |

如果配置目录中有 `config.json`，其中的 `chromePath`、`userDataDir` 等同名配置会覆盖相应默认值。改变启动配置不会切换已运行的实例；确需切换时，由用户结束当前会话并运行 `liepin quit`，下一条命令再按新配置启动。

`LIEPIN_SCREENSHOT_DIR` 和 `LIEPIN_DEBUG` 当前只在配置中定义，现有 CLI 命令未据此生成截图或额外调试日志。没有独立的截图命令，也没有生效的 `--debug` 选项。

## 故障处理

### 登录态失效

退出码 `2` 表示检测到登录态失效。执行一次 `liepin login`，在窗口内完成登录，再检查结果。不要把重复重登作为所有错误的处理办法。

### 出现验证码或安全验证页

退出码 `3` 表示需要停止自动化。由用户在现有可见窗口中检查并完成验证，确认后再决定是否恢复。需要 CLI 等待人工验证时，可由用户主动执行 `liepin login --timeout 300`。

返回 HTML 或无说明的 `{"flag":0}` 时，CLI 也会按安全异常处理，不能直接解释为登录过期或权益不足。账号权限、操作次数和页面状态要分别核对。

### 页面变为 about:blank 或操作中断连

立即停止并保留浏览器。不要自动刷新、重登、重启或循环试探。涉及打招呼、发消息或索要资料时，结果记为待核验，人工检查聊天记录后再决定是否继续。

空白页问题的历史复现见 [Viy1204/liepin-cli#23](https://github.com/Viy1204/liepin-cli/issues/23)。`0.2.9` 的页面会话实现与 `0.2.8` 不同：页面操作按需执行，主页面清空、执行中导航或断连时抛出 `PageUnavailableError`，仍使用退出码 `3` 并保留浏览器。生产路径验收见[页面会话验证记录](https://github.com/Viy1204/liepin-cli/blob/v0.2.9/experiments/issue23-ui/2026-10-27-page-session.md)；早期自定义 UI 路径另有[独立实验](https://github.com/Viy1204/liepin-cli/blob/v0.2.9/experiments/issue23-ui/README.md)和[对照记录](https://github.com/Viy1204/liepin-cli/blob/v0.2.9/experiments/issue23-ui/EVIDENCE.md)。这些路径的验收不能互相替代，一次环境下通过也不能证明所有 Chrome 版本、长期运行或自定义页面流程都稳定，升级不能代替出错后的停止与核验。

### 提示网络地址在境外

检查当前 VPN、系统代理和 `LIEPIN_PROXY` 配置，确认浏览器的实际访问路径符合平台要求。先人工确认招聘者页面能正常访问，再恢复 CLI 操作。

### Windows 上浏览器随命令结束关闭

默认启动方式会尝试通过 PowerShell/WMI 创建常驻浏览器，失败时会回退到普通启动。检查浏览器是否确实常驻，以及系统是否允许 WMI 启动；`LIEPIN_SPAWN_BREAKAWAY=false` 会禁用这项处理。

反馈问题时附 CLI、Node.js、浏览器版本、操作命令和退出码，并去掉候选人标识、消息正文、Cookie 和令牌。可在 [GitHub Issues](https://github.com/Viy1204/liepin-cli/issues) 提交。

## 源码开发说明

克隆仓库。

```bash
git clone https://github.com/Viy1204/liepin-cli.git
```

进入源码目录。

```bash
cd liepin-cli
```

安装开发依赖。

```bash
npm install
```

编译 CLI。

```bash
npm run build
```

检查源码构建出的帮助。

```bash
node dist/cli/index.js --help
```

运行本地测试。

```bash
npm test
```

源码构建可能包含尚未发布的改动，先核对所检出的分支和 `package.json`。[Viy1204/liepin-cli#24](https://github.com/Viy1204/liepin-cli/pull/24) 引入的页面会话实现及 `chatmsg --resolve-resume` 从 `0.2.9` 起提供，未包含在 `0.2.8`。历史卡片的 `card_resume_id` 不能直接当作当前简历 ID；现有消息来源字段仍保留。

开发使用的 CI 和发布配置分别见 [test.yml](.github/workflows/test.yml) 与 [publish.yml](.github/workflows/publish.yml)。发布工作流由 `v*` 标签触发，运行构建和测试后使用 npm Trusted Publishing 发布。

## 许可证

[GPL-3.0](./LICENSE)。
