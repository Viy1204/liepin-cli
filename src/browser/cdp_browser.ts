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

import { spawn } from 'node:child_process';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { config } from '../config.js';

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
 * 优先级：`LIEPIN_HEADLESS`（本 CLI 专属，显式覆盖）> `RECRUIT_BROWSER_HIDDEN`
 * （招聘工具链共读的单一来源）> 默认 **true**。
 *
 * 默认隐藏是有意的：有头窗口一启动就抢键盘焦点，会打断用户正在做的别的事。想看见
 * 窗口设 `RECRUIT_BROWSER_HIDDEN=false`（或 `LIEPIN_HEADLESS=false`）；想看浏览器
 * 在做什么而不要窗口，用 DSH 的「招聘浏览器」面板。
 */
export function resolveHeadlessFromEnv(): boolean {
  const own = process.env.LIEPIN_HEADLESS?.trim().toLowerCase();
  if (own === 'true' || own === '1' || own === 'yes' || own === 'y') return true;
  if (own === 'false' || own === '0' || own === 'no' || own === 'n') return false;
  return process.env.RECRUIT_BROWSER_HIDDEN?.trim().toLowerCase() !== 'false';
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

    const proc = spawn(executablePath, chromeArgs, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    proc.unref();

    // 端口是固定的，所以不需要解析 Chrome 的启动日志，直接轮询探针即可
    const deadline = Date.now() + LAUNCH_READY_MS;
    while (Date.now() < deadline) {
      const wsUrl = await probeRemoteDebuggingWsEndpoint();
      if (wsUrl) return await puppeteer.connect({ browserWSEndpoint: wsUrl });
      await sleep(300);
    }

    try {
      proc.kill();
    } catch {
      /* 进程可能已经自己退了 */
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

  /** 导航到指定 URL */
  async navigate(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' }): Promise<void> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: options?.waitUntil || 'networkidle2' });
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
