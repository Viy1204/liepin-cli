# Issue 27 风控停止验证

目标是处理 [Viy1204/liepin-cli issue 27](https://github.com/Viy1204/liepin-cli/issues/27)，验证 CLI 遇到安全验证后能否停止当前操作，并阻止后续命令继续访问业务页面。

## 验证边界

- 使用本地模拟数据，不在真实猎聘账号上重演高频操作。
- 不发送消息，不收藏或取消收藏真实候选人。
- issue 中的操作次数、冷却时长和间隔是报告内容，不代表平台公布的安全阈值。

## 报告中的失败信号

以下内容来自 issue 报告，尚不是本次运行复现。

- 首次跳转到 `safe.liepin.com/page/liepin/captchaPage_PC`，CLI 返回退出码 3。
- 人工验证后继续运行其他命令，后来跳转到 `safe.liepin.com/v/intercept/blankpage`。
- 最终拦截后，两次取消收藏仅报告 `页面协议请求超时`。
- 报告者确认账号被限制 2 小时。CLI 无法据此推导平台对其他账号的限制期限。

## 基线

2026-11-17，本地源码与 `origin/main` 一致，工作树干净。

```bash
npm run build
```

构建通过。

```bash
node dist/cli/index.js --help
```

CLI 帮助正常输出。

```bash
npm test
```

219 项测试通过，0 项失败，0 项跳过。

## 修复前离线复现

使用 `RecruitPageSession.create` 连接内存假协议。主文档 URL 是 `https://safe.liepin.com/v/intercept/blankpage`，`Runtime.evaluate` 保持挂起，协议超时设为 20ms。2026-11-17 实际输出如下。

```text
session_created=true
error_name=Error
error_message=页面协议请求超时
```

会话没有在已知安全页上立即停止。这个普通错误在 CLI 中映射为退出码 1，而不是风控退出码 3。

另行实际调用 `isRiskPageUrl`，`intercept/blankpage` 与 `captchaPage_PC` 均返回 `true`，普通推荐页面返回 `false`。缺口在会话未使用该信号立即停止，不是漏写拦截路径的正则。

当前注册表没有 `collect` 和 `uncollect`。实际运行 `node dist/cli/index.js uncollect issue-27-offline-fixture --json` 返回退出码 1，输出 `错误: 未知命令 'uncollect'`，没有连接浏览器。因此 issue 中这两条本地扩展命令的具体调用栈尚未复现。本次修复针对仓库共用的页面会话和命令分发。

## 失败测试先行

只添加回归测试后重新构建，生产代码未变。主线程实际执行如下。

```bash
node --test --test-name-pattern=issue27 dist/browser/recruit-page.test.js dist/cli/cli.test.js
```

8 项测试中 7 项失败，普通超时对照 1 项通过。关键失败输出如下。

```text
AssertionError [ERR_ASSERTION]: Missing expected rejection (RiskControlError).
AssertionError [ERR_ASSERTION]: 首次风控退出前应写入停止记录
```

预存停止记录后执行业务命令及 `login --force`，模拟浏览器实际记录了 `launch`、`probe`、`launch`，期望值为空。CLI 测试使用真实入口的独立子进程，只在浏览器适配边界注入假实现，所有配置、忙碌提示和计数均隔离在临时目录。

新增 `risk` 命令的状态和清除用例在旧代码上以“未知命令”失败。这两项属于新增停止状态的管理行为，不是对现有命令失败的直接复现。

## 修复约束

停止状态由配置目录中的单个记录持久保存，保留首次信号，不自动到期。业务命令在连接浏览器前检查记录。检查状态和显式解除停止均在本地完成，不查询平台。解除本地停止不代表猎聘账号限制已解除。

继续沿用 `RiskControlError` 和退出码 3。普通网络超时仍属于一般错误。首次启动的人工登录流程保留等待安全验证的例外，但 `login --force` 不能绕过此前已记录的停止。

## 修复后验收

主线程独立执行 `npm run build && npm test`，构建通过，完整测试 236 项通过，0 项失败，0 项跳过。相对基线新增 17 项 issue27 回归。

原离线复现重新执行，实际输出如下。初始化即失败，没有进入 `Runtime.evaluate`。

```text
error_name=RiskControlError
error_message=页面被跳转到猎聘安全验证页（当前 https://safe.liepin.com/v/intercept/blankpage）。猎聘出现安全异常，业务接口可能已被拦截。请立即停止自动化，不要自动重试、刷新或重登。使用 `liepin risk --json` 查看本地停止状态，人工核验并确认允许恢复后，才可用 `liepin risk --clear` 清除本地停止记录；这不代表猎聘已解除账号限制。
```

在独立临时配置目录中，直接执行真实 CLI 的 `risk` 命令，不注入浏览器替身。验证不存在记录、已有记录、`--clear=false` 和显式清除四种状态。实际输出如下。

```text
status_without_record=false
status_with_record=true
status_after_clear_false=true
status_after_clear=false
clear_message=当前没有本地停止记录。这不代表猎聘已解除账号限制，也不会自动重试此前操作。
```

这次直接执行还发现未停止时仍显示停止指引，已修正文案。文案收尾后重新构建并运行 `node --test dist/cli/cli.test.js`，18 项全部通过。

回归覆盖以下行为。

- 初始安全页面在创建页面协议会话与写视口前拒绝；运行中安全跳转立即终止挂起请求。
- 主页面回到普通 URL 后仍保留第一次故障；子 frame 不误触发主页面停止。
- 显式人工登录例外可等待验证，空白页停止规则仍生效。
- 首次退出码 3 写入仅含版本、时间及命令的记录；后续所有页面命令，包括强制登录，在浏览器访问前停止。
- 旧日期、损坏及不可读取的记录继续阻止操作；首次记录不被并发写入覆盖。
- 普通错误与登录失效不创建停止记录；停止记录写入失败会明确报错，仍返回 3 并清理资源。
- 离线管理与 `quit` 可用；被停止检查阻止的命令不会删除其他进程的 busy 提示。

执行 `npm pack --dry-run --json`，确认包中包含 `dist/common/risk-stop.js`、`dist/toolset/risk.js` 及随包 Skill。未创建发布包或执行 npm 发布。最终 `git diff --check` 通过。

未执行真实浏览器或猎聘平台验证，也未验证报告者的收藏扩展。

## Skill 校验

`skill-creator/scripts/quick_validate.py` 未能运行，当前 Python 环境缺少 `yaml` 模块，报错为 `ModuleNotFoundError: No module named 'yaml'`。未因此安装环境依赖。

已使用 Node 对比当前文件与 `HEAD` 的完整 frontmatter，结果一致；同时检查本地状态查询、显式清除及禁止 Agent 自行清除的指引均存在。未改变技能名称、触发描述、结构或引用路径，也未运行技能行为评测。

## 工作拆分检查

- Blocking first steps。先取得离线失败证据，再确定修复范围。
- Independent workstreams。只读源码调查与基线验证并行，源码改动由一个执行者负责。
- Shared mutable state。新增回归使用独立测试目录隔离配置，不修改真实账号配置。共享源码不并行写入。
- Smallest safe decomposition。复现、实现、回归共享同一错误传播链，由一个执行者按顺序修改，主线程独立验证。
