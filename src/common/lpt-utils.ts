/**
 * 猎聘招聘者端 (LPT) 工具函数
 */

import { Page } from 'puppeteer-core';
import { sleep, AuthExpiredError, RELOGIN_HINT, isAuthExpiredResponse } from './utils.js';
import { randomUUID } from 'crypto';

export const LIEPIN_LPT_API = 'https://api-lpt.liepin.com';

/**
 * 触发猎聘风控（验证码 / 频率限制 / 反爬虫挑战）时抛出。
 * 上层遇到此错误应立即停止重试，等待或让用户在浏览器中手动完成验证，
 * 连续换方案试探只会加重风控。
 */
export class RiskControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskControlError';
  }
}

const RISK_CONTROL_PATTERN = /验证码|安全验证|请完成验证|操作(过于)?频繁|访问异常|存在风险|风控/;

export { AuthExpiredError, RELOGIN_HINT, isAuthExpiredResponse } from './utils.js';

const PAGE_BLANKED_HINT =
  '猎聘招聘者端的安全脚本在检测到 CDP/DevTools 调试连接后可能主动清空页面。' +
  '请勿把 liepin-cli 挂到手动开启远程调试的日常浏览器上；' +
  '建议 `liepin quit` 后直接重跑命令，让 CLI 使用自管的常驻浏览器实例，' +
  '若仍复现，请在浏览器中重新打开 lpt.liepin.com 并完成安全验证。';

/**
 * 页面被猎聘安全脚本清空（跳到 about:blank）后，任何"已拿到的数据"都不可信、
 * 后续请求也必然失败，必须立即以可判别的异常终止（见 issue #17）。
 */
export function assertLptPageAlive(page: Page, when: string): void {
  const url = page.url();
  if (url === 'about:blank' || url.startsWith('chrome-error://')) {
    throw new RiskControlError(`${when}时页面已被清空（当前 ${url}）。${PAGE_BLANKED_HINT}`);
  }
}

/** evaluate 执行中页面被导航走时，puppeteer 抛的是上下文销毁类错误 */
const CONTEXT_DESTROYED_PATTERN = /Execution context was destroyed|Cannot find context|Target closed|Session closed/i;

/** LPT API 请求 */
export async function lptFetch(page: Page, url: string, opts: { body?: string; clientId?: string } = {}): Promise<any> {
  const { body = null, clientId = '40156' } = opts;
  const traceId = randomUUID();

  assertLptPageAlive(page, '发起请求');

  let result: any;
  try {
    result = await page.evaluate(async (fetchUrl: string, fetchBody: string | null, fetchClientId: string, fetchTraceId: string) => {
    try {
      const xsrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('XSRF-TOKEN='));
      const token = xsrf ? xsrf.split('=').slice(1).join('') : '';
      
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-client-type': 'web',
        'x-requested-with': 'XMLHttpRequest',
        'x-xsrf-token': token,
        'x-fscp-version': '1.1',
        'x-fscp-std-info': `{"client_id": "${fetchClientId}"}`,
        'x-fscp-fe-version': '',
        'x-fscp-trace-id': fetchTraceId,
        'x-fscp-bi-stat': JSON.stringify({ location: window.location.href }),
      };

      const resp = await fetch(fetchUrl, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: fetchBody,
      });
      
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text };
    } catch (e: any) {
      return { ok: false, status: 0, text: '', error: String(e?.message || e) };
    }
  }, url, body, clientId, traceId);
  } catch (e: any) {
    if (CONTEXT_DESTROYED_PATTERN.test(String(e?.message || e))) {
      assertLptPageAlive(page, '请求执行');
      throw new RiskControlError(`请求执行中页面发生了导航（${String(e?.message || e)}）。${PAGE_BLANKED_HINT}`);
    }
    throw e;
  }

  // 数据回来了但页面随即被清空：不能当成功返回，否则错误会被推迟到下一条命令（issue #17）
  assertLptPageAlive(page, '请求完成');

  const res = result as any;

  if (res.error) {
    throw new Error(`LPT 请求失败: ${res.error}`);
  }
  // 401/403 基本就是登录态没了，直接给重登指引，别让调用方去猜（须先于通用 !ok 分支）
  if (res.status === 401 || res.status === 403) {
    throw new AuthExpiredError(`猎聘登录态已失效（HTTP ${res.status}）。${RELOGIN_HINT}`);
  }
  if (!res.ok) {
    throw new Error(`LPT HTTP 错误: ${res.status}`);
  }
  if (res.text.trim().startsWith('<')) {
    throw new RiskControlError('LPT 返回了 HTML（可能是反爬虫挑战），请在浏览器中重新登录或完成验证后再试');
  }

  let data: any;
  try {
    data = JSON.parse(res.text);
  } catch (e) {
    throw new Error(`LPT JSON 解析失败: ${res.text.slice(0, 200)}`);
  }

  if (data?.flag !== 1) {
    const msg = String(data?.msg || data?.message || '');
    if (RISK_CONTROL_PATTERN.test(msg)) {
      throw new RiskControlError(`触发猎聘风控：${msg}。请停止自动化操作，在浏览器中手动完成验证后再继续`);
    }
    // -1401 / -1701 等登录态失效码：重试无意义，直接指引重登
    if (isAuthExpiredResponse(data)) {
      throw new AuthExpiredError(
        `猎聘登录态已失效（flag=${data?.flag}${msg ? `，${msg}` : ''}）。${RELOGIN_HINT}`,
      );
    }
  }

  return data;
}

/** 导航到 LPT 页面 */
export async function navigateToLpt(page: Page, path: string = '/recommend', waitSeconds: number = 3): Promise<void> {
  const url = `https://lpt.liepin.com${path}`;
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(waitSeconds * 1000);
  assertLptPageAlive(page, '导航');
}

/** 读取 imId */
export async function readLptImId(page: Page): Promise<string> {
  const result = await page.evaluate(() => {
    // Try cookie first
    const m = document.cookie.match(/imId_2=([^;]+)/i);
    if (m) return m[1];
    
    // Try localStorage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.toLowerCase().includes('imid')) {
          const v = localStorage.getItem(k);
          if (v) return v;
        }
        const v = localStorage.getItem(k) || '';
        if (v.includes('imId')) {
          const m2 = v.match(/"imId":"([^"]+)"/);
          if (m2) return m2[1];
        }
      }
    } catch (_) {}
    return '';
  });
  
  return result || '';
}
