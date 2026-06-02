/**
 * 猎聘招聘者端 (LPT) 工具函数
 */

import { Page } from 'puppeteer-core';
import { sleep } from './utils.js';

export const LIEPIN_LPT_API = 'https://api-lpt.liepin.com';

/** LPT API 请求 */
export async function lptFetch(page: Page, url: string, opts: { body?: string; clientId?: string } = {}): Promise<any> {
  const { body = null, clientId = '40156' } = opts;
  
  const result = await page.evaluate(async (fetchUrl: string, fetchBody: string | null, fetchClientId: string) => {
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
  }, url, body, clientId);
  
  const res = result as any;
  
  if (res.error) {
    throw new Error(`LPT 请求失败: ${res.error}`);
  }
  if (!res.ok) {
    throw new Error(`LPT HTTP 错误: ${res.status}`);
  }
  if (res.text.trim().startsWith('<')) {
    throw new Error('LPT 返回了 HTML（可能是反爬虫挑战），请重新登录');
  }
  
  try {
    return JSON.parse(res.text);
  } catch (e) {
    throw new Error(`LPT JSON 解析失败: ${res.text.slice(0, 200)}`);
  }
}

/** 导航到 LPT 页面 */
export async function navigateToLpt(page: Page, path: string = '/recommend', waitSeconds: number = 3): Promise<void> {
  const url = `https://lpt.liepin.com${path}`;
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(waitSeconds * 1000);
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
