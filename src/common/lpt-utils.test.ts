import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLptPageAlive, getResumeInfo, lptFetch, RiskControlError, safeGoto } from './lpt-utils.js';

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

test('safeGoto: 正常导航等待 networkidle2', async () => {
  const url = 'https://lpt.liepin.com/job/manager';
  const navigations: { url: string; options: unknown }[] = [];
  const page: any = {
    url: () => url,
    goto: async (target: string, options: unknown) => {
      navigations.push({ url: target, options });
    },
  };
  await safeGoto(page, url);
  assert.deepEqual(navigations, [{ url, options: { waitUntil: 'networkidle2' } }]);
});

test('safeGoto: goto 失败原样传播，不重试', async () => {
  const failure = new Error('boom');
  let navigations = 0;
  const page: any = {
    url: () => 'about:blank',
    goto: async () => {
      navigations++;
      throw failure;
    },
  };
  await assert.rejects(() => safeGoto(page, 'https://lpt.liepin.com/'), error => error === failure);
  assert.equal(navigations, 1);
});

test('safeGoto: 导航后主标签被清空时抛 RiskControlError，不返回成功或重试', async () => {
  let url = 'https://lpt.liepin.com/search';
  let navigations = 0;
  const page: any = {
    url: () => url,
    goto: async () => {
      navigations++;
      url = 'about:blank';
    },
  };
  await assert.rejects(() => safeGoto(page, 'https://lpt.liepin.com/job/manager'), assertStopAndVerify);
  assert.equal(navigations, 1);
});

for (const sample of [
  { label: '从 imInfoVo 读取候选人的 IM ID', detail: {}, imInfo: { usercImId: 'candidate-im-id' }, expected: 'candidate-im-id' },
  { label: '新旧字段同时存在时优先 imInfoVo', detail: { imId: 'legacy-im-id' }, imInfo: { usercImId: 'candidate-im-id' }, expected: 'candidate-im-id' },
  { label: '兼容旧 resumeDetailVo.imId', detail: { imId: 'legacy-im-id' }, imInfo: undefined, expected: 'legacy-im-id' },
  { label: '没有 IM ID 时保留空串', detail: {}, imInfo: undefined, expected: '' },
]) {
  test(`getResumeInfo: ${sample.label}`, async () => {
    const page: any = {
      url: () => 'https://lpt.liepin.com/search',
      evaluate: async () => ({
        ok: true,
        status: 200,
        text: JSON.stringify({
          flag: 1,
          data: {
            resumeDetailVo: { encodeUsercId: 'candidate-user-id', baseInfo: { name: '候选人' }, ...sample.detail },
            imInfoVo: sample.imInfo,
          },
        }),
      }),
    };
    assert.deepEqual(await getResumeInfo(page, 'resume-id'), {
      resumeId: 'resume-id',
      usercId: 'candidate-user-id',
      imId: sample.expected,
      name: '候选人',
    });
  });
}
