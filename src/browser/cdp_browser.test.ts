import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeRemoteHeadless, REMOTE_DEBUGGING_PORT, resolveHeadlessFromEnv } from './cdp_browser.js';

const HEADLESS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36';
const HEADFUL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/** 跑一段代码，跑完把两个开关变量还原成原样。 */
function withEnv(vars: Record<string, string>, fn: () => void): void {
  const names = ['LIEPIN_HEADLESS', 'RECRUIT_BROWSER_HIDDEN'];
  const saved: Record<string, string | undefined> = {};
  for (const n of names) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  try {
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    fn();
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

test('默认无头：有头窗口会抢键盘焦点，打断用户手上的事', () => {
  withEnv({}, () => assert.equal(resolveHeadlessFromEnv(), true));
});

test('RECRUIT_BROWSER_HIDDEN=false 退回有头', () => {
  withEnv({ RECRUIT_BROWSER_HIDDEN: 'false' }, () => assert.equal(resolveHeadlessFromEnv(), false));
  withEnv({ RECRUIT_BROWSER_HIDDEN: 'FALSE' }, () => assert.equal(resolveHeadlessFromEnv(), false));
});

test('LIEPIN_HEADLESS 优先级高于共读变量，两个方向都生效', () => {
  withEnv({ LIEPIN_HEADLESS: 'false', RECRUIT_BROWSER_HIDDEN: 'true' }, () =>
    assert.equal(resolveHeadlessFromEnv(), false),
  );
  withEnv({ LIEPIN_HEADLESS: 'true', RECRUIT_BROWSER_HIDDEN: 'false' }, () =>
    assert.equal(resolveHeadlessFromEnv(), true),
  );
});

test('无法识别的值不当作覆盖，回落到共读变量', () => {
  withEnv({ LIEPIN_HEADLESS: 'maybe', RECRUIT_BROWSER_HIDDEN: 'false' }, () =>
    assert.equal(resolveHeadlessFromEnv(), false),
  );
});

test('固定调试端口默认 53471，紧跟 boss-cli 的 53470', () => {
  assert.equal(REMOTE_DEBUGGING_PORT, 53471);
});

test('probeRemoteHeadless 按 /json/version 的 UA 判模式', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const serve = (body: unknown, ok = true) => {
    globalThis.fetch = (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  };

  serve({ 'User-Agent': HEADLESS_UA });
  assert.equal(await probeRemoteHeadless(1), true);

  serve({ 'User-Agent': HEADFUL_UA });
  assert.equal(await probeRemoteHeadless(1), false);

  // 没有 UA 字段：判不出来，不能瞎猜
  serve({});
  assert.equal(await probeRemoteHeadless(1), null);

  // 非 200：视为没有实例在跑
  serve({}, false);
  assert.equal(await probeRemoteHeadless(1), null);

  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  assert.equal(await probeRemoteHeadless(1), null);
});
