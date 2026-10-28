/**
 * 猎聘招聘者端 (LPT) 工具函数
 */

import type { RecruitPage } from '../browser/recruit-page.js';
import { sleep, AuthExpiredError, RiskControlError, PageUnavailableError, RELOGIN_HINT, isAuthExpiredResponse } from './utils.js';
import { randomUUID } from 'crypto';

export const LIEPIN_LPT_API = 'https://api-lpt.liepin.com';

const RISK_CONTROL_PATTERN = /验证码|安全验证|请完成验证|操作(过于)?频繁|访问异常|存在风险|风控/;

export { AuthExpiredError, RiskControlError, PageUnavailableError, RELOGIN_HINT, isAuthExpiredResponse } from './utils.js';

/**
 * 猎聘安全中心的拦截页：账号被判「行为异常」后，页面导航会被 302 到
 * `safe.liepin.com/page/liepin/captchaPage_PC?...&backurl=<原地址>`，要人工点图形验证。
 * 实测（2026-09-16）：此时 jobmanage.list 等接口仍 flag=1，但 resume-view 之类业务接口
 * 只回 `{"flag":0}`——所以「login 成功」不等于「业务可用」（issue #21 问题三）。
 */
const RISK_PAGE_URL_PATTERN = /safe\.liepin\.com|captchaPage/i;

export function isRiskPageUrl(url: string): boolean {
  return RISK_PAGE_URL_PATTERN.test(url);
}

export const RISK_PAGE_HINT =
  '猎聘安全中心已把账号判为「行为异常」，业务接口会被静默拦截。' +
  '请勿重试：运行 `liepin login`，在弹出的浏览器窗口里完成图形验证后再继续。';

const PAGE_BLANKED_HINT =
  '页面失效的触发原因尚未确定，请停止自动化，不要自动重试、刷新或重登。' +
  '若本次涉及发送消息或打招呼，结果待核验；请人工核对聊天记录，不要自动重发。' +
  '保留当前浏览器与登录状态，待人工检查后再决定是否恢复。';

/** 导航完成后检查主标签未被清空。 */
export async function safeGoto(page: RecruitPage, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle2' });
  assertPageNotBlanked(page, '导航');
}

/**
 * 页面被猎聘安全脚本清空（跳到 about:blank）后，任何"已拿到的数据"都不可信、
 * 后续请求也必然失败，必须立即以可判别的异常终止（见 issue #17）。
 */
export function assertPageNotBlanked(page: RecruitPage, when: string): void {
  const url = page.url();
  if (url === 'about:blank' || url.startsWith('chrome-error://')) {
    throw new PageUnavailableError(`${when}时页面已被清空（当前 ${url}）。${PAGE_BLANKED_HINT}`);
  }
}

/**
 * 除「页面被清空」外，还把「被 302 到安全中心验证页」视为不可继续：此时所有 LPT 接口
 * 都是跨域 fetch，必然失败，继续等只会白等（issue #21 问题四）。
 * `login` 例外——那里人就该停在验证页上过滑块，所以它只用 assertPageNotBlanked。
 */
export function assertLptPageAlive(page: RecruitPage, when: string): void {
  assertPageNotBlanked(page, when);
  if (isRiskPageUrl(page.url())) {
    throw new RiskControlError(`${when}时页面被跳转到猎聘安全验证页（当前 ${page.url()}）。${RISK_PAGE_HINT}`);
  }
}

/** evaluate 执行中页面被导航走时，puppeteer 抛的是上下文销毁类错误 */
const CONTEXT_DESTROYED_PATTERN = /Execution context was destroyed|Cannot find context|Target closed|Session closed/i;

/** LPT API 请求 */
export async function lptFetch(page: RecruitPage, url: string, opts: { body?: string; clientId?: string } = {}): Promise<any> {
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
    if (e instanceof PageUnavailableError) throw e;
    if (CONTEXT_DESTROYED_PATTERN.test(String(e?.message || e))) {
      assertPageNotBlanked(page, '请求执行');
      throw new PageUnavailableError(`请求执行中页面发生了导航（${String(e?.message || e)}）。${PAGE_BLANKED_HINT}`);
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
    // 光秃秃的 {"flag":0}（无 msg 无 data）是风控拦业务接口的形态，不是简历权益/权限问题；
    // 当成一般错误会把使用者带去查「简历点余额」并反复重试，反而加重风控（issue #21 问题三）
    if (data?.flag === 0 && !msg && (data.data === undefined || data.data === null)) {
      throw new RiskControlError(
        `接口只返回了 {"flag":0}（无任何说明），这是猎聘风控拦截业务接口的典型形态。${RISK_PAGE_HINT}`,
      );
    }
  }

  return data;
}

/** 导航到 LPT 页面 */
export async function navigateToLpt(page: RecruitPage, path: string = '/recommend', waitSeconds: number = 3): Promise<void> {
  const url = `https://lpt.liepin.com${path}`;
  await safeGoto(page, url);
  await sleep(waitSeconds * 1000);
  assertLptPageAlive(page, '导航');
}

/** 读取 imId */
export async function readLptImId(page: RecruitPage): Promise<string> {
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

export interface LptResumeInfo {
  resumeId: string;
  usercId: string;
  imId: string;
  name: string;
}

/** 用 resume_id 换候选人的 usercId / imId / 姓名（resume-view 接口） */
export async function getResumeInfo(page: RecruitPage, resumeId: string): Promise<LptResumeInfo> {
  const form = new URLSearchParams();
  form.set('pageParamVo', JSON.stringify({
    resIdEncode: resumeId,
    sfrom: 'R_SEARCH_CONDITION',
    applyId: '',
  }));

  const data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.rresume.usere.pc.resume-view`, {
    body: form.toString(),
  });

  if (data.flag !== 1) {
    throw new Error(`获取简历失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  const vo = data.data?.resumeDetailVo;
  if (!vo?.encodeUsercId) {
    throw new Error('获取简历失败: 响应缺少 encodeUsercId');
  }

  return {
    resumeId,
    usercId: String(vo.encodeUsercId),
    imId: String(data.data?.imInfoVo?.usercImId || vo.imId || ''),
    name: vo.baseInfo?.name || '',
  };
}

/** 打开简历详情页并展开右侧 IM 聊天面板（输入框出现即就绪） */
export async function openResumeImPanel(page: RecruitPage, resumeId: string): Promise<void> {
  await safeGoto(page, `https://lpt.liepin.com/resume/detail?resIdEncode=${encodeURIComponent(resumeId)}&sfrom=R_SEARCH_CONDITION`);
  assertLptPageAlive(page, '打开简历详情');
  await page.waitForSelector('.xpath-open-im-btn', { timeout: 20000 });
  await page.click('.xpath-open-im-btn');
  await page.waitForSelector('.im-ui-textarea', { timeout: 20000 });
}
