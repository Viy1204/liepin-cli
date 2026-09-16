/**
 * 猎聘登录命令 - 招聘者端
 *
 * 登录成功的判定走「打一个需要鉴权的 BFF 接口」，不看 DOM 特征。
 * 原因见 probeSession 注释：猎聘风控拦截页的 title 同样含"招聘"，
 * 靠 title / class 选择器会把拦截页判成登录成功。
 *
 * **默认复用已有登录态**：先探一次，还有效就直接返回，不碰浏览器（issue #21）。
 * 只有确实需要人工扫码时才把无头实例换成有头——「重登」是高风险动作，
 * 短时间内反复重启 + 重新扫码正是猎聘判「行为异常」的输入。
 */

import { Page } from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../common/utils.js';
import {
  LIEPIN_LPT_API,
  lptFetch,
  RiskControlError,
  RISK_PAGE_HINT,
  assertPageNotBlanked,
  isRiskPageUrl,
  safeGoto,
  setPageRuntime,
} from '../common/lpt-utils.js';
import { CdpBrowser, closeRemoteBrowser, probeRemoteHeadless } from '../browser/cdp_browser.js';
import { config } from '../config.js';

export interface LoginOptions {
  timeout?: number;
  force?: boolean;
}

/** 探测结果：登录可用 / 未登录 / 撞上风控需人工过验证 */
type SessionState = 'ok' | 'anonymous' | 'risk';

/** 与 joblist 同一个 BFF 端点，pageSize=1 只为验鉴权，不取数据 */
const SESSION_PROBE_URL = `${LIEPIN_LPT_API}/api/com.liepin.recruitbff.lpt.jobmanage.list`;

/** 24 小时内允许的「真·重新登录」次数，超过就要显式 --force（issue #21 问题二） */
const LOGIN_RATE_LIMIT = 3;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 登录历史文件：只存交互式登录（真的重启浏览器 + 等人扫码）的时间戳 */
function historyFile(dir: string = config.configDir): string {
  return join(dir, 'login-history.json');
}

/** 读最近 24 小时内的交互式登录时间戳（旧的直接丢弃） */
export function readRecentLogins(now: number = Date.now(), dir?: string): number[] {
  const file = historyFile(dir);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const list: unknown[] = Array.isArray(raw?.interactive) ? raw.interactive : [];
    return list
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t) && now - t < RATE_WINDOW_MS)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** 记一次交互式登录。写不进去只是丢了频率保护的记账，不该让登录本身失败 */
export function recordLogin(now: number = Date.now(), dir?: string): void {
  try {
    const target = dir ?? config.configDir;
    mkdirSync(target, { recursive: true });
    const list = [...readRecentLogins(now, dir), now];
    writeFileSync(historyFile(dir), JSON.stringify({ interactive: list }));
  } catch {
    /* 记账失败不影响登录 */
  }
}

/** 距离最早那次记录满 24 小时还有多久，用于告诉用户"多久之后可以再来一次" */
function hoursUntilQuotaFrees(logins: number[], now: number): number {
  const oldest = logins[0];
  if (oldest === undefined) return 0;
  return Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / (60 * 60 * 1000)));
}

/**
 * 权威登录态探测。
 *
 * 不用 DOM 特征判断：猎聘「行为异常」风控拦截页的 document.title 同样是
 * "专业招聘平台-猎聘"，用 title.includes('招聘') 会把拦截页当成登录成功，
 * 于是 login 打印 ✅ 而下一条命令立刻 "LPT 请求失败: Failed to fetch"。
 * 直接打下游命令真正依赖的鉴权接口，成功即成功，不存在误判。
 */
async function probeSession(page: Page): Promise<SessionState> {
  // 已经被 302 到安全中心：接口全是跨域必失败，不必再打一次，省一次请求
  if (isRiskPageUrl(page.url())) return 'risk';

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

/** 探测时临时打开 Runtime：等待期间要保持关闭，否则新页面加载会被安全脚本清页 */
async function probeWithRuntime(page: Page): Promise<SessionState> {
  await setPageRuntime(page, true);
  try {
    await sleep(300); // 等 Runtime.enable 回放执行上下文，evaluate 才有 context 可用
    return await probeSession(page);
  } finally {
    await setPageRuntime(page, false);
  }
}

/** 是否还停在登录页：只看 URL。等待期间 Runtime 是关闭的，不能 evaluate 读 DOM */
function onLoginPage(page: Page): boolean {
  return /\/login|\/signin|\/passport/.test(page.url());
}

export async function login(page: Page, options: LoginOptions): Promise<any> {
  const { timeout = 120 } = options;
  const force = options.force === true || String(options.force) === 'true';

  console.log('正在打开猎聘招聘者端...');
  await safeGoto(page, 'https://lpt.liepin.com/');
  await sleep(2000);

  // 先看现有登录态还在不在：在就什么都不用动。会话 cookie 是 is_persistent=0，
  // 关掉浏览器就等于退出登录，所以"能不重启就不重启"直接决定了要不要再扫一次码。
  // 已经被弹回登录页就不必打接口了，肯定是未登录，省一次请求。
  const initial = onLoginPage(page) ? 'anonymous' : await probeWithRuntime(page);
  if (initial === 'ok' && !force) {
    console.log('');
    console.log('✅ 登录态仍然有效，无需重新登录（浏览器未重启）');
    console.log('   要强制重新走一遍扫码流程：liepin login --force');
    console.log('');
    return {
      success: true,
      message: '登录态仍然有效（复用现有会话，未重启浏览器）',
      reused: true,
    };
  }

  // 到这里说明真的要人工介入了。先过频率闸：短时间内反复重登本身就是风控信号。
  const now = Date.now();
  const recent = readRecentLogins(now);
  if (recent.length >= LOGIN_RATE_LIMIT && !force) {
    console.log('');
    console.log(`⛔ 已拦下这次登录：过去 24 小时内已经登录 ${recent.length} 次（上限 ${LOGIN_RATE_LIMIT} 次）`);
    console.log('   反复「关实例 → 重启 → 重新扫码」正是猎聘判定「行为异常」的输入，');
    console.log(`   继续重试只会加重风控。建议 ${hoursUntilQuotaFrees(recent, now)} 小时后再试。`);
    console.log('   确认必须现在登录：liepin login --force');
    console.log('');
    return {
      success: false,
      message: `24 小时内登录次数已达上限（${recent.length}/${LOGIN_RATE_LIMIT}），已拦截以免触发风控。确需登录请加 --force`,
      rate_limited: true,
    };
  }
  if (recent.length > 0) {
    console.log(`ℹ️  过去 24 小时内这是第 ${recent.length + 1} 次登录（上限 ${LOGIN_RATE_LIMIT} 次）。`);
  }

  // 扫码必须看得见：端口上那只若是无头，关掉再以有头拉起（登录态本来就已经失效了，不存在丢失）
  let activePage = page;
  let restarted: CdpBrowser | null = null;
  try {
    if ((await probeRemoteHeadless()) === true) {
      console.log('当前浏览器是无头的，正在切换成有头窗口以便扫码...');
      await closeRemoteBrowser();
      process.env.LIEPIN_HEADLESS = 'false';
      restarted = new CdpBrowser({ headless: false });
      activePage = await restarted.launch();
      await safeGoto(activePage, 'https://lpt.liepin.com/');
      await sleep(2000);
    }

    recordLogin(now);
    return await waitForLogin(activePage, timeout);
  } finally {
    restarted?.disconnect();
  }
}

/** 等人在窗口里完成扫码 / 安全验证，期间周期性探测鉴权接口 */
async function waitForLogin(page: Page, timeout: number): Promise<any> {
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

    // 页面被安全脚本清空成 about:blank 等不出任何结果——立即失败（退出码 3），
    // 别让用户对着空白页干等到超时（issue #17）。
    // 注意这里不能用 assertLptPageAlive：安全验证页正是要人停在上面过滑块的地方。
    assertPageNotBlanked(page, '等待登录');

    // 被 302 到安全中心：不必打接口也知道是风控，直接提示人去点验证（issue #21 问题四）
    if (isRiskPageUrl(page.url()) && !riskNoticeShown) {
      riskNoticeShown = true;
      lastState = 'risk';
      showRiskNotice();
    }

    // 还停在登录页就没必要打接口，省一次请求
    if (!onLoginPage(page) && Date.now() - lastProbe >= PROBE_INTERVAL_MS) {
      lastProbe = Date.now();
      lastState = await probeWithRuntime(page);

      if (lastState === 'risk' && !riskNoticeShown) {
        riskNoticeShown = true;
        showRiskNotice();
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
          reused: false,
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

function showRiskNotice(): void {
  console.log('');
  console.log('⚠️  猎聘弹出了安全验证（行为异常）');
  console.log('   请在浏览器窗口里点「点击验证」并完成滑块，这里会继续等待。');
  console.log(`   ${RISK_PAGE_HINT}`);
  console.log('');
}

/** 登录命令定义 */
export const loginCommand = {
  name: 'login',
  description: '登录猎聘招聘者端（登录态仍有效时直接复用，不重启浏览器）',
  args: [
    { name: 'timeout', type: 'int', default: 120, help: '登录超时时间（秒）' },
    { name: 'force', type: 'bool', default: false, help: '强制重新扫码登录（跳过复用与 24 小时频率保护）' },
  ],
  columns: [
    { header: '结果', key: 'result', width: 80 },
  ],
  func: login,
};
