# Issue 23 自定义页面流程实验

这个独立 controller 用于对照测试 issue 23 的三个普通页面分支。它减少调试协议订阅，只在初始化发送 `Page.enable` 和 `Page.getFrameTree`；没有启用 Runtime 控制台事件或 Debugger。页面取值仍使用 `Runtime.evaluate` / `Runtime.callFunctionOn`。

它没有修改猎聘安全脚本、console、User-Agent、Cookie 或空白页导航。它不代表 CLI 全部功能已经修复，也不保证其他环境不会出现空白页。

## 运行实验

要求 Node.js 24 或更高版本。此要求仅限实验，不改变 CLI 的运行要求。脚本不安装依赖、不启动浏览器、不登录。

先使用已有的浏览器窗口，手动进入推荐或搜索页面。确保只有一个 `https://lpt.liepin.com` / `https://safe.liepin.com` 标签。在实验期间，关闭其他自动化客户端连接和 DevTools；不要同时运行 Puppeteer、BiDi、招聘巡检或其他 CLI 命令。调试地址只接受本机 HTTP 地址。

在仓库根目录执行下面对应页面的命令。端口需要替换为你的已有浏览器端口：

```sh
node experiments/issue23-ui/controller.mjs open-card-preview --browser-url http://127.0.0.1:53471
node experiments/issue23-ui/controller.mjs close-preview --browser-url http://127.0.0.1:53471
node experiments/issue23-ui/controller.mjs mapping-search-once "动画 UE" --browser-url http://127.0.0.1:53471
```

`open-card-preview` 可追加已知的编码简历 ID；省略时点击首张可见推荐卡片的姓名。查看简历可能消耗权益。两个预览命令要求当前已在 `/recommend`；搜索命令要求当前已在 `/search`。脚本不会跳转到对应页面。

追加 `--observe-ms 60000` 可以持连接观察最多 60 秒。默认不额外观察。追加 `--trace-methods` 只在标准错误输出 CDP 方法名及数量，不记录参数。

成功时标准输出只有命令、去掉查询参数与片段的 URL、正文长度、可见关闭控件数量、搜索框值和结果卡片数量，不输出简历正文或候选人 ID。搜索框值可能包含你的输入，不要使用个人敏感信息作为搜索词。错误只输出原因。

退出码 `0` 表示本轮完成，`1` 表示输入、页面结构或连接错误，`3` 表示发现空白、安全、登录或异常来源页面。出现 `3` 后停止自动化，保留浏览器现场并人工核验。即使页面随后恢复，也不会继续本轮。没有重试、重连、发送或自动登录逻辑。脚本结束只断 WebSocket，不关闭用户浏览器。

## 接入现有 controller

```js
import { connectMinimalPage } from './minimal-ui-driver.mjs';

const { page, disconnect } = await connectMinimalPage({
  browserURL: 'http://127.0.0.1:53471',
  onCommand: method => recordMethodName(method),
});
try {
  // 仅接入已审阅的三个页面分支，并保留 controller 的安全检查。
} finally {
  await disconnect();
}
```

`page` 是有限 adapter，不是完整 Puppeteer `Page`。它只提供本实验使用的取值、元素定位、滚动、鼠标、三种按键和有限 Input session。`createCDPSession()` 不创建独立 CDP session；`detach()` 只禁用该 Input 包装。它不支持多标签、frame 定位、下载、发送和导航恢复。只读范围由 controller 的三个分支约束，`evaluate` 本身不是权限沙箱。

## 离线验证

```sh
node --test experiments/issue23-ui/controller.test.mjs
```

测试使用合成 DOM 和本机假 CDP 协议，不启动 Chrome、不访问猎聘或招聘账号。它验证分支行为、参数、输出、空白页后的停止、短暂故障记忆、断开、页面唯一性和协议范围。真实空白页问题是否恢复，需要在原作者的环境运行同一组页面操作验证；离线测试通过不能替代真实页面验证。
