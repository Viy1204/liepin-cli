import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 这两个环境变量必须在 import 被测模块**之前**设好，所以下面用动态 import：
 *
 * - `LIEPIN_CONFIG_DIR`：登录频率记录写到临时目录，别碰用户真实的 ~/.liepin-cli
 * - `LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT`：指向一个没人监听的端口，让 probeRemoteHeadless()
 *   返回 null。**不这么做，跑测试会把用户正在用的那只浏览器关掉**（登录态是会话
 *   cookie，关掉就等于退出登录）。
 */
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'liepin-cli-login-'));
process.env.LIEPIN_CONFIG_DIR = CONFIG_DIR;
process.env.LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT = '53599';

const { login, readRecentLogins, recordLogin } = await import('./login.js');

process.on('exit', () => rmSync(CONFIG_DIR, { recursive: true, force: true }));

/**
 * 假 Page：只实现 login() 真正用到的 Page 契约。
 *
 * page.evaluate 有两个调用方，按实参个数区分：
 *   - 0 个实参  -> readLptImId 之类的 DOM 读取
 *   - 4 个实参  -> lptFetch（传 url / body / clientId / traceId）
 */
function fakePage(opts: { url: string; apiText: string; apiTextAfter?: string; switchAfter?: number }) {
  const { url, apiText } = opts;
  let probeCount = 0;

  const page: any = {
    goto: async () => {},
    url: () => url,
    mainFrame: () => ({ client: { send: async () => {} } }),
    evaluate: async (_fn: any, ...args: any[]) => {
      if (args.length === 4) {
        probeCount += 1;
        const text =
          opts.apiTextAfter && probeCount > (opts.switchAfter ?? 1) ? opts.apiTextAfter : apiText;
        return { ok: true, status: 200, text };
      }
      return '';
    },
  };

  return { page, probes: () => probeCount };
}

const AUTHED = JSON.stringify({ flag: 1, data: { ejobList: [] } });
const ANONYMOUS = JSON.stringify({ flag: -1401, msg: '未登录' });
const RISK_HTML = '<html><body>行为异常，请进行安全验证</body></html>';

function freshHistory(): void {
  rmSync(join(CONFIG_DIR, 'login-history.json'), { force: true });
}

test('login: 登录态还有效时直接复用，不重启浏览器、不等扫码（issue #21）', async () => {
  freshHistory();
  const { page, probes } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: AUTHED });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, true);
  assert.equal(result.reused, true);
  // 只探一次就返回，不进等待循环
  assert.equal(probes(), 1);
  // 复用不算一次登录，不该占掉 24 小时配额
  assert.equal(readRecentLogins().length, 0);
});

test('login: --force 时跳过复用，照常走扫码等待流程', async () => {
  freshHistory();
  const { page } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: AUTHED });

  const result = await login(page, { timeout: 3, force: true });

  assert.equal(result.success, true);
  assert.equal(result.reused, false);
  assert.equal(result.message, '登录成功');
});

test('login: 登录态失效后在等待中扫码成功，判定走鉴权接口', async () => {
  freshHistory();
  const { page } = fakePage({
    url: 'https://lpt.liepin.com/recommend',
    apiText: ANONYMOUS,
    apiTextAfter: AUTHED,
    switchAfter: 1,
  });

  const result = await login(page, { timeout: 10 });

  assert.equal(result.success, true);
  assert.equal(result.message, '登录成功');
});

test('login: 风控拦截页不得判成登录成功（title 也含"招聘"）', async () => {
  freshHistory();
  const { page } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: RISK_HTML });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.match(result.message, /安全验证/);
});

test('login: 被 302 到安全中心时，光看 URL 就报风控，不必等到超时（issue #21 问题四）', async () => {
  freshHistory();
  const { page, probes } = fakePage({
    url: 'https://safe.liepin.com/page/liepin/captchaPage_PC?backurl=https://lpt.liepin.com/',
    apiText: ANONYMOUS,
  });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.match(result.message, /安全验证/);
  // URL 已经说明问题，不该再去打接口
  assert.equal(probes(), 0);
});

test('login: 未登录响应不得判成登录成功', async () => {
  freshHistory();
  const { page } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: ANONYMOUS });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.equal(result.message, '登录超时');
});

test('login: 还停在登录页时不打鉴权接口，避免请求频率喂风控', async () => {
  freshHistory();
  const { page, probes } = fakePage({
    url: 'https://lpt.liepin.com/login?backurl=x',
    apiText: AUTHED,
  });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.equal(probes(), 0);
});

test('login: 等待期间页面被清空为 about:blank 时立即抛 RiskControlError，不再干等', async () => {
  freshHistory();
  const { page } = fakePage({ url: 'about:blank', apiText: ANONYMOUS });

  await assert.rejects(
    () => login(page, { timeout: 3 }),
    (e: any) => e.name === 'RiskControlError' && /about:blank/.test(e.message),
  );
});

test('login: 24 小时内登录超过 3 次直接拦下，不再重启浏览器（issue #21 问题二）', async () => {
  freshHistory();
  const now = Date.now();
  for (const t of [now - 6 * 3600_000, now - 3 * 3600_000, now - 3600_000]) recordLogin(t);

  const { page } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: ANONYMOUS });
  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.equal(result.rate_limited, true);
  assert.match(result.message, /--force/);
});

test('login: --force 可以突破频率闸（用户明确要求时不挡路）', async () => {
  freshHistory();
  const now = Date.now();
  for (const t of [now - 6 * 3600_000, now - 3 * 3600_000, now - 3600_000]) recordLogin(t);

  const { page } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: ANONYMOUS });
  const result = await login(page, { timeout: 3, force: true });

  assert.notEqual(result.rate_limited, true);
  assert.equal(result.message, '登录超时');
});

test('登录历史只保留 24 小时内的记录，旧的自动过期', () => {
  freshHistory();
  const now = Date.now();
  recordLogin(now - 25 * 3600_000);
  recordLogin(now - 2 * 3600_000);

  const recent = readRecentLogins(now);

  assert.equal(recent.length, 1);
});

test('登录历史文件损坏时当作空历史，不让登录挂掉', () => {
  freshHistory();
  writeFileSync(join(CONFIG_DIR, 'login-history.json'), 'not json at all');

  assert.deepEqual(readRecentLogins(), []);
});
