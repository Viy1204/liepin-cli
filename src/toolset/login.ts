/**
 * 猎聘登录命令 - 招聘者端
 *
 * 登录成功的判定走「打一个需要鉴权的 BFF 接口」，不看 DOM 特征。
 * 原因见 probeSession 注释：猎聘风控拦截页的 title 同样含"招聘"，
 * 靠 title / class 选择器会把拦截页判成登录成功。
 */

import { Page } from 'puppeteer-core';
import { sleep } from '../common/utils.js';
import { LIEPIN_LPT_API, lptFetch, RiskControlError, assertLptPageAlive, safeGoto, setPageRuntime } from '../common/lpt-utils.js';

export interface LoginOptions {
  timeout?: number;
}

/** 探测结果：登录可用 / 未登录 / 撞上风控需人工过验证 */
type SessionState = 'ok' | 'anonymous' | 'risk';

/** 与 joblist 同一个 BFF 端点，pageSize=1 只为验鉴权，不取数据 */
const SESSION_PROBE_URL = `${LIEPIN_LPT_API}/api/com.liepin.recruitbff.lpt.jobmanage.list`;

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

/** 是否还停在登录页：只看 URL。等待期间 Runtime 是关闭的，不能 evaluate 读 DOM */
function onLoginPage(page: Page): boolean {
  return /\/login|\/signin|\/passport/.test(page.url());
}

export async function login(page: Page, options: LoginOptions): Promise<any> {
  const { timeout = 120 } = options;

  console.log('正在打开猎聘招聘者端...');
  await safeGoto(page, 'https://lpt.liepin.com/');
  await sleep(2000);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  请在浏览器中完成登录（扫码或账号密码）');
  console.log('  这是招聘者端 (lpt.liepin.com)');
  console.log('  登录成功后会自动检测');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // 等待扫码期间保持 Runtime 关闭：扫码成功后的跳转是一次新页面加载，
  // 此时若 Runtime 开着会被安全脚本清页（与 issue #17 同一机制，见 safeGoto）。
  // 只在探测登录态时短暂打开，探完立即关闭。
  await setPageRuntime(page, false);

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

    // 风控验证页可以等人工点验证，但页面被安全脚本清空成 about:blank 等不出
    // 任何结果——立即失败（退出码 3），别让用户对着空白页干等到超时（issue #17）
    assertLptPageAlive(page, '等待登录');

    // 还停在登录页就没必要打接口，省一次请求
    if (!onLoginPage(page) && Date.now() - lastProbe >= PROBE_INTERVAL_MS) {
      lastProbe = Date.now();
      await setPageRuntime(page, true);
      try {
        await sleep(300); // 等 Runtime.enable 回放执行上下文，evaluate 才有 context 可用
        lastState = await probeSession(page);
      } finally {
        await setPageRuntime(page, false);
      }

      if (lastState === 'risk' && !riskNoticeShown) {
        riskNoticeShown = true;
        console.log('');
        console.log('⚠️  猎聘弹出了安全验证（行为异常）');
        console.log('   请在浏览器窗口里点「点击验证」并完成滑块，这里会继续等待。');
        console.log('');
      }

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
