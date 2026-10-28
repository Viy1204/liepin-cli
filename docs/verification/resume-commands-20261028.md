# 简历与触达命令核查（2026-10-28）

本轮从调用方的命令参考核查 `recommend`、`resume`、`chatmsg`、`greet`、`request-phone` 与 `request-resume`。真实平台验证限于读取推荐和简历；没有向候选人发送消息或请求。以下样本只记录字段与验证结果，不保存身份、Cookie 或签名 URL。

## 已确认的缺陷

| 缺陷 | 复现证据 | 修复 |
|---|---|---|
| 推荐遗漏有效简历 ID | 保存的 20 条推荐 URL 均有 `resIdEncode`，输出均无 `resume_id`；取 URL ID 可直接读取详情 | 从 URL 提取 `resume_id`，保留旧字段 |
| 工作职位输出分类编码 | 同一真实工作记录 `title` 是职位文本，`jobTitleName` 是 `N002026` 等编码 | 优先使用 `title` |
| 工作、教育起止年月丢失 | 真实接口同时返回 `startShow`、`endShow` 与时长，旧输出只有时长 | 保留年月和时长 |
| 候选人 IM 标识层级错误 | 真实响应 `resumeDetailVo.imId` 缺失，`imInfoVo.usercImId` 与同一推荐的 `im_id` 相同 | 优先使用 `imInfoVo.usercImId`，兼容旧字段 |
| 非法自定义参数先开聊后报错 | `user_id + message` 在拒绝前调用 `to-chat2` | 在平台操作前拒绝 |
| 沟通权限失败仍继续开聊 | 本地权限响应 `flag:0` 被跳过，仍调用 `to-chat2` | 检查失败时停止，不发起沟通 |
| 已有会话无动作却声称已打招呼 | 无 `message` 时只查询 `has-chat`，输出却声称使用了预设招呼语 | 文案明确本次未发送 |
| 发送确认接受旧消息或无关消息 | 旧同文、空首行页面匹配、候选人新来信、按钮变灰可被当成成功 | 以新增消息、发送者和内容/请求类型联合确认 |
| 延迟出现的预设招呼误认自定义消息 | 新开聊后刷新仍是空列表，随后仅预设同文出现，会被认作自定义消息成功 | 新开聊同时补发自定义文本时不自动确认；已有会话才按新增消息核验 |

修复前本地假页面复现的原始输出：

```json
{"scenario":"invalid user_id + message","error":"发送自定义消息需要传入 resume_id；仅传 user_id 时只能发起默认沟通","wrote_before_rejection":true,"requests":["has-chat","get-job-chat-list","check-chat-privlege","to-chat2"]}
{"scenario":"unrelated candidate reply after request","confirmed":true}
```

同一假页面复现场景在修复后输出：

```json
{"scenario":"invalid user_id + message","wrote_before_rejection":false,"requests":[]}
{"scenario":"existing chat without message","message":"会话已存在，本次未发送新消息","confirmed":false}
{"scenario":"unrelated candidate reply after request","confirmed":false}
```

推荐与简历回归测试在修复前分别出现 `resume_id === undefined`、`1年 示例公司 / N000305`；修复后返回有效简历 ID，以及 `2025.10-至今 1年 示例公司 / 海外品牌推广专员`。

## 真实读取验证

通过构建后的 CLI 执行推荐查询，取返回的 `resume_id` 调用 `resume --json`，再核对同份接口响应，结果为：

```json
{
  "recommend_to_resume": "PASS",
  "candidate_identity": "PASS",
  "work_dates": "PASS",
  "education_dates": "PASS",
  "work_titles": "PASS",
  "imInfoVo_usercImId_matches_recommend_im_id": "PASS",
  "has_legacy_resumeDetailVo_imId": false
}
```

没有修改 `sfrom=R_SEARCH_CONDITION`；本轮样本在该值下可读取。卡片原始 ID 与当前 ID 不同是观察事实，但“每次更新都会换 ID、旧版本已删除”的原因没有得到证实。

## 请求卡片类型依据

静态检查猎聘公开的 fe-imb-pc 4.12.8 前端资源，没有执行下载的 JavaScript：

- [vendors.7bd529a5.js](https://concat.lietou-static.com/fe-imb-pc/v6/4.12.8/js/vendors.7bd529a5.js)，SHA256 `8bfef5a0cdedd016c0141cd42a54a27735e2783366cd4b003d9ca78686b7865e`。
- [common.cc1555df.js](https://concat.lietou-static.com/fe-imb-pc/v6/4.12.8/js/common.cc1555df.js)，SHA256 `9f54f0d3abf783e60bed5972f219b6e72313ec13a9cccddf4e59178021cd7a98`。

vendors 模块 36 定义 `wechat=1`、`phone=2`、`resume=3`。模块 106 的导出 `e` 用 `Number(bizKey.substring(bizKey.length-1,bizKey.length))` 解码交换类型。请求卡片模块 597/598 将 `message.bizData.bizKey` 交给这个函数，再把结果传给模块 128 的接受/拒绝动作。common 模块 154 把 `ASK_EXCHANGE=206` 的 `bizType="4"` 映射到模块 597，把 `"6"/"7"` 映射到模块 598。

因此可在已知请求消息分支里按 `bizKey` 尾位 2/3 区分手机号/简历请求。本地真实手机号卡片 `206 / 4 / 10002` 与该逻辑一致；本轮没有发送真实简历请求，不据此断言简历的完整 `bizKey` 固定为 `10003`。未知消息类型保持未确认。

## 未改动的命令契约

`chatmsg <im_id>` 与 `chatmsg --oppositeImId <im_id>` 等价；`resume <resume_id>` 与 `resume --talentId <resume_id>` 等价。没有 `--im-id` / `--resume-id` 别名。离线核验这些参数路由及 resolver 的登录、风险、页面失效异常传播均符合原契约。

发送确认仅证明当前查询窗口内出现了匹配的新消息，不证明候选人已阅读或同意。未确认结果需人工核对，不自动重发。平台未返回的日期、培养形式及其他模块不作推断。

独立审查另用假页面复现新开聊的时序问题，三个消息列表依次为 `[]`、`[]`、`[delayed-preset]`，自定义消息未落库却得到 `confirmed:true`。修复去掉用一次额外读取消除歧义的假设，新开聊与自定义文本并存时保守返回未确认；该场景没有再次执行任何真实发送。不查询消息确认的分支仍在发送后的等待结束时检查页面连接和 URL，清页、断连或跳转验证页保持原有停止语义。

## 最终验证

- `npm run build` 通过。
- `npm test`：219 项通过，0 失败、0 跳过，包含延迟预设招呼及发送后页面失效回归，使用正常生产延迟运行；日志在本地忽略目录 `tmp/resume-command-tests-final.txt`。
- 独立审查复核了推荐/简历/IM 映射和触达确认；延迟预设招呼问题修复后，新会话返回未确认、已有会话真实新增同文可确认，无阻塞项。
- 原始触达假页面复现场景重新运行通过，见上方修复前后输出。
- 构建后的 CLI 帮助正确列出推荐/投递简历 ID 来源及 `chatmsg --resolve-resume` 示例。
- `git diff --check` 通过。

以上记录对应 `0.2.10` 的修复验收；版本变更见[发布说明](../releases/v0.2.10.md)。本机全局 `liepin` 链接到源码目录。npm 发布结果以 registry 的版本记录为准。
