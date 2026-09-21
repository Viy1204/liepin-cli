/**
 * CDP 浏览器实现
 * 基于 Puppeteer-core 和 Chrome DevTools Protocol
 *
 * 浏览器**跨命令常驻**：占用固定调试端口，命令结束只断 CDP、不关浏览器，于是
 * 下一条命令直连同一只实例（同一登录态），DSH 的「招聘浏览器」面板也能并行挂上来
 * 做镜像。要真正关掉用 `liepin quit`。
 *
 * 不使用 `puppeteer.launch()`：它依赖的 `@puppeteer/browsers` 会在 **Node 进程 exit 时
 * kill 浏览器子进程**，launch 出来的浏览器活不过一条命令，常驻和镜像都无从谈起。
 * 改为自己 `spawn(detached)` + `connect`，退出时只断 CDP。
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { config } from '../config.js';
import { safeGoto } from '../common/lpt-utils.js';

export interface BrowserOptions {
  headless?: boolean;
  proxy?: string;
  userDataDir?: string;
  chromePath?: string;
}

/**
 * 固定的远程调试端口：liepin-cli 使用独立的 user-data-dir，因此可以稳定占用一个端口，
 * 让多条命令与 DSH 面板通过 `http://127.0.0.1:<port>/json/version` 复用同一只浏览器。
 * boss-cli 用 53470，这里紧跟 53471。可用 `LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT` 覆盖。
 */
export const REMOTE_DEBUGGING_PORT: number = (() => {
  const raw = process.env.LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  }
  return 53471;
})();

const PROBE_TIMEOUT_MS = 800;
const LAUNCH_READY_MS = 30_000;

/**
 * 是否以无头（隐藏）方式启动。
 *
 * 优先级：`LIEPIN_HEADLESS`（本 CLI 专属）> `RECRUIT_BROWSER_HIDDEN`（招聘工具链共读的
 * 统一覆盖开关，**只在显式设置时生效**）> **默认：有头**。
 *
 * **2026-09-21 翻默认：无头 → 有头，两家 CLI 就此对齐。**
 *
 * 翻的依据是 0819 定无头时还不存在的两条：
 *
 * 1. **本 CLI 刻意不覆盖 User-Agent**（见 launch 处的注释：伪造 UA 与 sec-ch-ua Client
 *    Hints、真实平台矛盾，本身就是指纹）。于是无头下猎聘收到的 UA 里明晃晃带着
 *    `HeadlessChrome/<ver>` —— 等于每个请求都自报「我是自动化工具」。BOSS 侧正是踩了
 *    这条：账号被限 web 登录，页面文案写「检测到使用第三方招聘管理系统、插件、外挂、
 *    软件等辅助工具」。0819 判「猎聘风控与有头/无头无关」时只验了 Runtime 域清页这一种
 *    形态，没把 UA 这条算进去。
 * 2. **2026-09-20 实测**：连续无头调用后账号被判「行为异常」，302 到
 *    `safe.liepin.com/.../captchaPage_PC`，业务接口开始静默拦截。这是第二种风控形态，
 *    与 0819 观测到的清页不是一回事。
 *
 * ⚠️ 不能说已证明「无头是唯一成因」——调用频次、issue #21 的重登循环都可能有份。但
 * UA 自报这条是确定存在的送分题，先摘掉；代价（有头窗口抢键盘焦点）已知且可控。
 *
 * 0819 关于清页的结论仍然成立：猎聘安全脚本在页面加载瞬间检测 CDP 会话的 Runtime 域，
 * 启用则把页面清成 about:blank——这条**与有头/无头无关**，照旧由 safeGoto 规避。
 *
 * `RECRUIT_BROWSER_HIDDEN` 的语义仍是「统一覆盖」而不是「提供默认值」。想回到无头：
 * `LIEPIN_HEADLESS=true`。
 */
export function resolveHeadlessFromEnv(): boolean {
  const own = process.env.LIEPIN_HEADLESS?.trim().toLowerCase();
  if (own === 'true' || own === '1' || own === 'yes' || own === 'y') return true;
  if (own === 'false' || own === '0' || own === 'no' || own === 'n') return false;
  const shared = process.env.RECRUIT_BROWSER_HIDDEN?.trim().toLowerCase();
  if (shared === 'true' || shared === '1' || shared === 'yes' || shared === 'y') return true;
  if (shared === 'false' || shared === '0' || shared === 'no' || shared === 'n') return false;
  return false;
}

/**
 * 无头模式追加的启动参数。
 *
 * 无头虚拟屏默认是 800x600（Chromium 文档化的默认值），这是个已知的强自动化指纹，
 * 而 `--window-size` **抬不动它** —— 只有 `--screen-info` 能改（Chrome 142+，且仅
 * 无头下有效）。`workAreaBottom=40` 让 `screen.availHeight` 小于 `screen.height`，
 * 模拟真实桌面的任务栏。注意四个命名参数必须分开写（workAreaTop/Bottom/Left/Right），
 * 写成 `workArea=` 会让 Chrome 直接启动失败。
 */
const LAUNCH_ARGS_HEADLESS_SCREEN = ['--screen-info={0,0 1920x1080 workAreaBottom=40}'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const execFileAsync = promisify(execFile);

/**
 * 把 exe + argv 拼成一条 Windows 命令行（CreateProcess 的 lpCommandLine 语义）：
 * 含空白或引号的参数整体加双引号，内部 `"` 前补反斜杠，结尾反斜杠成对翻倍。
 * `--screen-info={0,0 1920x1080 ...}` 这类带空格的参数不加引号会被拆成多个参数，
 * Chrome 直接启动失败（2026-09-16 实测）。
 */
export function toWindowsCommandLine(exe: string, args: string[]): string {
  const quote = (s: string): string => {
    if (s.length > 0 && !/[\s"]/.test(s)) return s;
    let out = '"';
    let pendingBackslashes = 0;
    for (const ch of s) {
      if (ch === '\\') {
        pendingBackslashes++;
        continue;
      }
      if (ch === '"') {
        out += '\\'.repeat(pendingBackslashes * 2 + 1) + '"';
        pendingBackslashes = 0;
        continue;
      }
      out += '\\'.repeat(pendingBackslashes) + ch;
      pendingBackslashes = 0;
    }
    return out + '\\'.repeat(pendingBackslashes * 2) + '"';
  };
  return [exe, ...args].map(quote).join(' ');
}

/**
 * Windows 上是否让浏览器脱离父进程的 Job Object（默认开；`LIEPIN_SPAWN_BREAKAWAY=false` 关）。
 *
 * issue #21 的根因：从 AI Agent 的后台任务里调用 CLI 时，宿主通常把整棵进程树放进一个
 * `KILL_ON_JOB_CLOSE` 的 Job Object。`spawn({ detached: true })` 只是新建进程组，**逃不出 Job**，
 * 于是 CLI 进程一结束 Chrome 就被连带 TerminateProcess——用户看到的是"窗口自己关了"，
 * profile 留下 `exit_type: Crashed`，下次启动弹「Chrome 未正确关闭」，而会话 cookie
 * （`_e_ld_auth_` / `XSRF-TOKEN` 都是 is_persistent=0）随进程一起没了，只能反复重新扫码。
 */
function shouldBreakawayFromJob(): boolean {
  if (process.platform !== 'win32') return false;
  const v = process.env.LIEPIN_SPAWN_BREAKAWAY?.trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no' || v === 'n');
}

/**
 * 经 WMI `Win32_Process.Create` 拉起浏览器：进程由系统服务 WmiPrvSE.exe 创建，因此不在
 * 调用方的 Job Object 里，但仍属于当前交互登录会话（有头窗口照常可见，2026-09-16 Win10 实测）。
 * 命令行经环境变量交给 PowerShell，省掉再套一层引号转义。
 * 返回 PID；起不来（无 PowerShell、策略禁 WMI 等）返回 null，调用方退回普通 spawn。
 */
async function spawnViaWmi(commandLine: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create ' +
          '-Arguments @{CommandLine=$env:LIEPIN_SPAWN_CMDLINE}; ' +
          'if ($r.ReturnValue -ne 0) { exit 1 }; $r.ProcessId',
      ],
      { env: { ...process.env, LIEPIN_SPAWN_CMDLINE: commandLine }, timeout: 15_000, windowsHide: true },
    );
    const pid = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * 探测固定调试端口上是否已有在跑的 Chrome：直接命中 `/json/version` 拿
 * `webSocketDebuggerUrl`，不依赖 `DevToolsActivePort` 这种二级状态文件（可能陈旧、
 * 被清理，或路径 UUID 漂移）。命中即可复用，未命中表示需要 spawn。
 */
async function probeRemoteDebuggingWsEndpoint(
  port: number = REMOTE_DEBUGGING_PORT,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { webSocketDebuggerUrl?: string };
    const ws = data.webSocketDebuggerUrl;
    return typeof ws === 'string' && ws.length > 0 ? ws : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探测端口上已在跑的那只浏览器是不是无头：读 `/json/version` 的 User-Agent，无头
 * Chrome 报 `HeadlessChrome/<ver>`，有头报 `Chrome/<ver>`。
 *
 * 必须这样读**进程外的真实状态**：liepin-cli 每条命令都是独立进程，任何进程内变量
 * 刚起时都是空的，靠它们判断等于不判断。返回 null 表示端口上没有实例在跑。
 *
 * ⚠️ 一旦决定伪装 UA 来规避指纹，这个判据就失效，需要换信号。
 */
export async function probeRemoteHeadless(
  port: number = REMOTE_DEBUGGING_PORT,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { 'User-Agent'?: string };
    const ua = data['User-Agent'];
    return typeof ua === 'string' ? /HeadlessChrome/i.test(ua) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 关掉端口上已在跑的浏览器（本进程没有它的引用时用，例如 `quit`，或 login 需要
 * 从无头切回有头）。登录态在 user-data-dir 里，不会因此丢失。
 * 返回 false 表示本来就没有实例在跑。
 */
export async function closeRemoteBrowser(port: number = REMOTE_DEBUGGING_PORT): Promise<boolean> {
  const wsUrl = await probeRemoteDebuggingWsEndpoint(port);
  if (!wsUrl) return false;
  try {
    const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

export class CdpBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private options: BrowserOptions;

  constructor(options: BrowserOptions = {}) {
    this.options = {
      headless: options.headless ?? resolveHeadlessFromEnv(),
      proxy: options.proxy ?? config.proxy,
      userDataDir: options.userDataDir ?? config.userDataDir,
      chromePath: options.chromePath ?? config.chromePath,
    };
  }

  /** 连上浏览器：端口上已有实例就复用，没有才拉起一只。 */
  async launch(): Promise<Page> {
    if (this.browser) {
      return this.page!;
    }

    const existingWsUrl = await probeRemoteDebuggingWsEndpoint();
    this.browser = existingWsUrl
      ? await puppeteer.connect({ browserWSEndpoint: existingWsUrl })
      : await this.spawnAndConnect();

    const pages = (await this.browser.pages()).filter((p) => !p.isClosed());
    this.page = pages[0] ?? (await this.browser.newPage());

    await this.page.setViewport({
      width: config.viewport.width,
      height: config.viewport.height,
    });

    // 不覆盖 User-Agent：伪造的 UA 与 sec-ch-ua Client Hints、真实平台矛盾，反而是风控指纹

    return this.page;
  }

  /** 自己 spawn 一只常驻浏览器，再按固定端口连上去。 */
  private async spawnAndConnect(): Promise<Browser> {
    const executablePath = this.options.chromePath;
    if (!executablePath) {
      throw new Error('Chrome/Edge 可执行文件路径未设置。请设置 CHROME_PATH 或 PUPPETEER_EXECUTABLE_PATH 环境变量。');
    }

    // 不加 --no-sandbox / --disable-gpu 等开关：均为自动化特征，且桌面环境不需要
    const userArgs = [
      `--window-size=${config.viewport.width},${config.viewport.height}`,
      // 上一只若被外力杀掉（Job Object 连带、任务管理器），别弹「要恢复页面吗？Chrome 未正确关闭」
      '--hide-crash-restore-bubble',
      ...(this.options.headless ? LAUNCH_ARGS_HEADLESS_SCREEN : []),
      ...(this.options.proxy ? [`--proxy-server=${this.options.proxy}`] : []),
    ];

    const chromeArgs = puppeteer
      .defaultArgs({
        browser: 'chrome',
        userDataDir: this.options.userDataDir,
        headless: this.options.headless,
        args: userArgs,
      })
      // --enable-automation 是最直白的自动化特征；about:blank / data:, 会占掉起始页
      .filter((a) => a !== '--enable-automation' && a !== 'about:blank' && a !== 'data:,');

    if (!chromeArgs.some((a) => a.startsWith('--remote-debugging-'))) {
      chromeArgs.push(`--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`);
    }

    // Windows 优先走 WMI，让浏览器脱离调用方的 Job Object（见 shouldBreakawayFromJob）
    let pid = shouldBreakawayFromJob()
      ? await spawnViaWmi(toWindowsCommandLine(executablePath, chromeArgs))
      : null;

    if (pid === null) {
      const proc = spawn(executablePath, chromeArgs, {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      proc.unref();
      pid = proc.pid ?? null;
    }

    // 端口是固定的，所以不需要解析 Chrome 的启动日志，直接轮询探针即可
    const deadline = Date.now() + LAUNCH_READY_MS;
    while (Date.now() < deadline) {
      const wsUrl = await probeRemoteDebuggingWsEndpoint();
      if (wsUrl) return await puppeteer.connect({ browserWSEndpoint: wsUrl });
      await sleep(300);
    }

    if (pid !== null) {
      try {
        process.kill(pid);
      } catch {
        /* 进程可能已经自己退了 */
      }
    }
    throw new Error(
      `浏览器启动超时：端口 ${REMOTE_DEBUGGING_PORT} 在 ${LAUNCH_READY_MS}ms 内未就绪。` +
        `检查是否有别的实例占用了 ${this.options.userDataDir}。`,
    );
  }

  /** 获取当前页面 */
  async getPage(): Promise<Page> {
    if (!this.page) {
      return this.launch();
    }
    return this.page;
  }

  /** 导航到指定 URL（走 safeGoto 规避猎聘加载期 CDP 检测） */
  async navigate(url: string): Promise<void> {
    const page = await this.getPage();
    await safeGoto(page, url);
  }

  /**
   * 断开 CDP 连接，**不关闭浏览器**——浏览器跨命令常驻，下条命令直连同一只实例，
   * DSH 面板的镜像也才有东西可连。要真正关掉用 `liepin quit`。
   */
  disconnect(): void {
    if (this.browser) {
      try {
        this.browser.disconnect();
      } catch {
        /* 已经断了 */
      }
      this.browser = null;
      this.page = null;
    }
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.browser?.connected ?? false;
  }

  /** 获取浏览器实例 */
  getBrowser(): Browser | null {
    return this.browser;
  }
}
