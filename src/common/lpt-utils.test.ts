import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLptPageAlive, RiskControlError, safeGoto } from './lpt-utils.js';

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
