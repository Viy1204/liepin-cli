/**
 * CDP 浏览器实现
 * 基于 Puppeteer-core 和 Chrome DevTools Protocol
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { config } from '../config.js';

export interface BrowserOptions {
  headless?: boolean;
  proxy?: string;
  userDataDir?: string;
  chromePath?: string;
}

export class CdpBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private options: BrowserOptions;

  constructor(options: BrowserOptions = {}) {
    this.options = {
      headless: options.headless ?? config.headless,
      proxy: options.proxy ?? config.proxy,
      userDataDir: options.userDataDir ?? config.userDataDir,
      chromePath: options.chromePath ?? config.chromePath,
    };
  }

  /** 启动浏览器 */
  async launch(): Promise<Page> {
    if (this.browser) {
      return this.page!;
    }

    const executablePath = this.options.chromePath;
    if (!executablePath) {
      throw new Error('Chrome/Edge 可执行文件路径未设置。请设置 CHROME_PATH 或 PUPPETEER_EXECUTABLE_PATH 环境变量。');
    }

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      `--window-size=${config.viewport.width},${config.viewport.height}`,
    ];

    if (this.options.proxy) {
      args.push(`--proxy-server=${this.options.proxy}`);
    }

    if (this.options.headless) {
      args.push('--headless=new');
    }

    this.browser = await puppeteer.launch({
      executablePath,
      args,
      userDataDir: this.options.userDataDir,
    });

    this.page = await this.browser.newPage();
    
    // 设置视口
    await this.page.setViewport({
      width: config.viewport.width,
      height: config.viewport.height,
    });

    // 设置 User-Agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    return this.page;
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

  /** 关闭浏览器 */
  async close(): Promise<void> {
    if (this.browser) {
      const browser = this.browser;
      const browserProcess = browser.process();
      let timeout: NodeJS.Timeout | null = null;
      try {
        timeout = setTimeout(() => {
          try {
            browser.disconnect();
          } catch (_) {}
          browserProcess?.kill('SIGKILL');
        }, 3000);
        await browser.close();
      } catch {
        try {
          browser.disconnect();
        } catch (_) {}
        browserProcess?.kill('SIGKILL');
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      this.browser = null;
      this.page = null;
    }
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  /** 获取浏览器实例 */
  getBrowser(): Browser | null {
    return this.browser;
  }
}
