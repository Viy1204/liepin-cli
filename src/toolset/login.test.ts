import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login } from './login.js';

/**
 * 假 Page：只实现 login() 真正用到的 Page 契约。
 *
 * page.evaluate 有两个调用方，按实参个数区分：
 *   - 1 个实参  -> readPageState（传风控文案正则）
 *   - 4 个实参  -> lptFetch（传 url / body / clientId / traceId）
 */
function fakePage(opts: { url: string; bodyText?: string; apiText: string }) {
  const { url, bodyText = '', apiText } = opts;
  let probeCount = 0;

  const page: any = {
    goto: async () => {},
    evaluate: async (_fn: any, ...args: any[]) => {
      if (args.length === 4) {
        probeCount += 1;
        return { ok: true, status: 200, text: apiText };
      }
      return {
        url,
        onLoginPage: /\/login|\/signin|\/passport/.test(url),
        onRiskPage: new RegExp(String(args[0])).test(bodyText),
      };
    },
  };

  return { page, probes: () => probeCount };
}

const AUTHED = JSON.stringify({ flag: 1, data: { ejobList: [] } });
const ANONYMOUS = JSON.stringify({ flag: -1401, msg: '未登录' });
const RISK_HTML = '<html><body>行为异常，请进行安全验证</body></html>';

test('login: 鉴权接口通过才算登录成功', async () => {
  const { page } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: AUTHED });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, true);
  assert.equal(result.message, '登录成功');
});

test('login: 风控拦截页不得判成登录成功（title 也含"招聘"）', async () => {
  // 复现线上故障：页面已离开 /login，document.title 仍是"专业招聘平台-猎聘"，
  // 但接口返回 HTML 挑战。旧实现在这里报 ✅，随后每条命令都 Failed to fetch。
  const { page } = fakePage({
    url: 'https://lpt.liepin.com/recommend',
    bodyText: '行为异常 尊敬的客户您好，猎聘安全中心发现您的帐号或IP可能存在异常 点击验证',
    apiText: RISK_HTML,
  });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.match(result.message, /安全验证/);
});

test('login: 未登录响应不得判成登录成功', async () => {
  const { page } = fakePage({ url: 'https://lpt.liepin.com/recommend', apiText: ANONYMOUS });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.equal(result.message, '登录超时');
});

test('login: 还停在登录页时不打鉴权接口，避免请求频率喂风控', async () => {
  const { page, probes } = fakePage({
    url: 'https://lpt.liepin.com/login?backurl=x',
    apiText: AUTHED,
  });

  const result = await login(page, { timeout: 3 });

  assert.equal(result.success, false);
  assert.equal(probes(), 0);
});
