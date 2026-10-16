import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLptPageAlive, lptFetch, RiskControlError, safeGoto } from './lpt-utils.js';

const fakePage = (url: string) => ({ url: () => url }) as any;

test('assertLptPageAlive: about:blank 抛 RiskControlError（issue #17 安全脚本清空页面）', () => {
  assert.throws(
    () => assertLptPageAlive(fakePage('about:blank'), '请求完成'),
    (e: any) => e instanceof RiskControlError && /about:blank/.test(e.message),
  );
});

test('assertLptPageAlive: chrome-error 页同样视为不可继续', () => {
  assert.throws(
    () => assertLptPageAlive(fakePage('chrome-error://chromewebdata/'), '导航'),
    RiskControlError,
  );
});

test('assertLptPageAlive: 正常 LPT 页面不抛错', () => {
  assertLptPageAlive(fakePage('https://lpt.liepin.com/search'), '发起请求');
});

function assertStopAndVerify(error: unknown): boolean {
  assert.ok(error instanceof RiskControlError);
  assert.match(error.message, /停止自动化/);
  assert.match(error.message, /待核验/);
  assert.match(error.message, /不要自动重发/);
  assert.doesNotMatch(error.message, /请直接重跑|quit.*重跑/);
  return true;
}

test('空白页提示要求停止并核验发送结果，不引导重跑（#23）', () => {
  assert.throws(
    () => assertLptPageAlive(fakePage('about:blank'), '发送后回读'),
    assertStopAndVerify,
  );
});

test('lptFetch: 请求前已空白时不发请求', async () => {
  let requests = 0;
  const page: any = {
    url: () => 'about:blank',
    evaluate: async () => { requests++; },
  };
  await assert.rejects(() => lptFetch(page, 'https://example.invalid'), assertStopAndVerify);
  assert.equal(requests, 0);
});

test('lptFetch: 成功响应后页面清空时不返回成功，也不重试', async () => {
  let url = 'https://lpt.liepin.com/search';
  let requests = 0;
  const page: any = {
    url: () => url,
    evaluate: async () => {
      requests++;
      url = 'about:blank';
      return { ok: true, status: 200, text: '{"flag":1,"data":{}}' };
    },
  };
  await assert.rejects(() => lptFetch(page, 'https://example.invalid'), assertStopAndVerify);
  assert.equal(requests, 1);
});

test('lptFetch: 执行上下文销毁时不引导重跑或重发', async () => {
  let requests = 0;
  const page: any = {
    url: () => 'https://lpt.liepin.com/search',
    evaluate: async () => {
      requests++;
      throw new Error('Execution context was destroyed');
    },
  };
  await assert.rejects(() => lptFetch(page, 'https://example.invalid'), assertStopAndVerify);
  assert.equal(requests, 1);
});

/** 记录调用顺序的假 Page：mainFrame().client.send + goto */
function recordingPage(opts: { gotoError?: Error } = {}) {
  const calls: string[] = [];
  const page: any = {
    mainFrame: () => ({ client: { send: async (m: string) => { calls.push(m); } } }),
    goto: async () => {
      calls.push('goto');
      if (opts.gotoError) throw opts.gotoError;
    },
  };
  return { page, calls };
}

test('safeGoto: 导航期间关闭 Runtime，加载完成后恢复', async () => {
  const { page, calls } = recordingPage();
  await safeGoto(page, 'https://lpt.liepin.com/job/manager');
  assert.deepEqual(calls, ['Runtime.disable', 'goto', 'Runtime.enable']);
});

test('safeGoto: goto 抛错也要恢复 Runtime', async () => {
  const { page, calls } = recordingPage({ gotoError: new Error('boom') });
  await assert.rejects(() => safeGoto(page, 'https://lpt.liepin.com/'), /boom/);
  assert.deepEqual(calls, ['Runtime.disable', 'goto', 'Runtime.enable']);
});

test('safeGoto: 拿不到主会话（mock page）时退化为普通 goto', async () => {
  const calls: string[] = [];
  const page: any = { goto: async () => { calls.push('goto'); } };
  await safeGoto(page, 'https://lpt.liepin.com/');
  assert.deepEqual(calls, ['goto']);
});
