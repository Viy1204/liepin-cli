import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLptPageAlive, RiskControlError } from './lpt-utils.js';

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
