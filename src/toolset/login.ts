/**
 * 猎聘登录命令 - 招聘者端
 *
 * 登录成功的判定走「打一个需要鉴权的 BFF 接口」，不看 DOM 特征。
 * 原因见 probeSession 注释：猎聘风控拦截页的 title 同样含"招聘"，
 * 靠 title / class 选择器会把拦截页判成登录成功。
 */

import { Page } from 'puppeteer-core';
import { sleep } from '../common/utils.js';
import { LIEPIN_LPT_API, lptFetch, RiskControlError } from '../common/lpt-utils.js';

export interface LoginOptions {
  timeout?: number;
}

/** 探测结果：登录可用 / 未登录 / 撞上风控需人工过验证 */
type SessionState = 'ok' | 'anonymous' | 'risk';

/** 与 joblist 同一个 BFF 端点，pageSize=1 只为验鉴权，不取数据 */
const SESSION_PROBE_URL = `${LIEPIN_LPT_API}/api/com.liepin.recruitbff.lpt.jobmanage.list`;

/** 风控拦截页的可见文案，用于给用户明确的"去点验证"提示 */
const RISK_PAGE_PATTERN = /行为异常|安全验证|请进行安全验证|点击验证/;

/**
 * 权威登录态探测。
 *
 * 不用 DOM 特征判断：猎聘「行为异常」风控拦截页的 document.title 同样是
 * "专业招聘平台-猎聘"，用 title.includes('招聘') 会把拦截页当成登录成功，
 * 于是 login 打印 ✅ 而下一条命令立刻 "LPT 请求失败: Failed to fetch"。
 * 直接打下游命令真正依赖的鉴权接口，成功即成功，不存在误判。
 */
async function probeSession(page: Page): Promise<SessionState> {
  const requestVo = {
    keywordKind: '0',
    keyword: '',
    curPage: 0,
    pageSize: 1,
    jobListType: '0',
    shareFlag: '2',
  };
  const form = new URLSearchParams();
  form.set('requestVo', JSON.stringify(requestVo));

  try {
    const data = await lptFetch(page, SESSION_PROBE_URL, { body: form.toString() });
    return data?.flag === 1 ? 'ok' : 'anonymous';
  } catch (e) {
    if (e instanceof RiskControlError) {
      return 'risk';
    }
    return 'anonymous';
  }
}

/** 读取页面状态：是否还停在登录页、是否是风控拦截页 */
async function readPageState(page: Page): Promise<{ url: string; onLoginPage: boolean; onRiskPage: boolean }> {
  return page
    .evaluate((riskSource: string) => {
      const url = window.location.href;
      const onLoginPage = /\/login|\/signin|\/passport/.test(url);
      const text = document.body?.innerText?.slice(0, 2000) || '';
      return { url, onLoginPage, onRiskPage: new RegExp(riskSource).test(text) };
    }, RISK_PAGE_PATTERN.source)
    .catch(() => ({ url: '', onLoginPage: true, onRiskPage: false }));
}

export async function login(page: Page, options: LoginOptions): Promise<any> {
  const { timeout = 120 } = options;

  console.log('正在打开猎聘招聘者端...');
  await page.goto('https://lpt.liepin.com/', { waitUntil: 'networkidle2' });
  await sleep(2000);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  请在浏览器中完成登录（扫码或账号密码）');
  console.log('  这是招聘者端 (lpt.liepin.com)');
  console.log('  登录成功后会自动检测');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const startTime = Date.now();
  const timeoutMs = timeout * 1000;
  // 探测接口有成本，扫码期间别每 2s 打一次，避免把请求频率本身喂成风控信号
  const PROBE_INTERVAL_MS = 5000;
  let lastProbe = 0;
  let riskNoticeShown = false;
  let lastState: SessionState = 'anonymous';

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  等待登录中... ${elapsed}s / ${timeout}s`);

    const pageState = await readPageState(page);

    if (pageState.onRiskPage && !riskNoticeShown) {
      riskNoticeShown = true;
      console.log('');
      console.log('⚠️  猎聘弹出了安全验证（行为异常）');
      console.log('   请在浏览器窗口里点「点击验证」并完成滑块，这里会继续等待。');
      console.log('');
    }

    // 还停在登录页就没必要打接口，省一次请求
    if (!pageState.onLoginPage && Date.now() - lastProbe >= PROBE_INTERVAL_MS) {
      lastProbe = Date.now();
      lastState = await probeSession(page);

      if (lastState === 'ok') {
        console.log('');
        console.log('✅ 登录成功！');
        console.log('   已登录猎聘招聘者端（已通过鉴权接口验证）');
        console.log('   Cookie 已保存到用户数据目录');
        console.log('');

        return {
          success: true,
          message: '登录成功',
        };
      }
    }

    await sleep(1000);
  }

  console.log('');
  if (lastState === 'risk' || riskNoticeShown) {
    console.log('❌ 登录未完成：卡在猎聘安全验证上');
    console.log('   在浏览器里点「点击验证」过掉滑块，再用更长的窗口重试：');
    console.log('   liepin login --timeout 600');
  } else {
    console.log('❌ 登录超时，请重试');
  }

  return {
    success: false,
    message: lastState === 'risk' || riskNoticeShown ? '卡在猎聘安全验证，登录未完成' : '登录超时',
  };
}

/** 登录命令定义 */
export const loginCommand = {
  name: 'login',
  description: '登录猎聘招聘者端',
  args: [
    { name: 'timeout', type: 'int', default: 120, help: '登录超时时间（秒）' },
  ],
  columns: [
    { header: '结果', key: 'result', width: 80 },
  ],
  func: login,
};
