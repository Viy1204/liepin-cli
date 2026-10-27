import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import test from 'node:test';
import { CDPSessionEvent, type CDPSession } from 'puppeteer-core';
import { RecruitPageSession } from './recruit-page.js';

class FakeSession extends EventEmitter {
  detached = false;
  connectionEvents = new EventEmitter();
  connection() { return this.connectionEvents; }
  disconnect = new AbortController();
  calls: Array<{ method: string; params: any }> = [];
  frame = { id: 'main', loaderId: 'initial', url: 'https://lpt.liepin.com/recommend' };
  globals: Record<string, unknown> = {};
  navigate: (params: any) => Promise<any> = async () => ({ frameId: 'main', loaderId: 'next' });
  evaluate: ((params: any) => Promise<any>) | undefined;
  point = { x: 30, y: 40, ready: true };

  async send(method: string, params: any = {}): Promise<any> {
    this.calls.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: this.frame } };
    if (method === 'Page.navigate') return this.navigate(params);
    if (method === 'Runtime.evaluate') {
      if (this.evaluate) return this.evaluate(params);
      try {
        const value = await vm.runInNewContext(params.expression, this.globals);
        return { result: value === undefined ? { type: 'undefined' } : { type: typeof value, value } };
      } catch (error) {
        return { result: { type: 'object' }, exceptionDetails: { text: 'Uncaught', exception: { description: String(error) } } };
      }
    }
    if (method === 'Runtime.callFunctionOn') return { result: { type: 'object', value: this.point } };
    return {};
  }

  async detach(): Promise<void> {
    this.detached = true;
    this.disconnect.abort();
  }

  commit(url: string, loaderId = 'next', frameId = 'main', parentId?: string): void {
    this.emit('Page.frameNavigated', { frame: { id: frameId, loaderId, url, parentId } });
  }

  idle(loaderId = 'next', frameId = 'main'): void {
    this.emit('Page.lifecycleEvent', { frameId, loaderId, name: 'networkAlmostIdle' });
  }

  async page(options: { allowInitialBlank?: boolean; timeoutMs?: number } = {}) {
    return RecruitPageSession.create(this as unknown as CDPSession, { timeoutMs: 100, signal: this.disconnect.signal, ...options });
  }
}

test('连接和取值不订阅 console、Runtime 事件或调试器，保留异步参数与异常', async () => {
  const session = new FakeSession();
  const page = await session.page();
  const text = '中文 "quote" \\ \n </script>';
  assert.equal(page.url(), session.frame.url);
  assert.equal(await page.evaluate(async value => `${value}!`, text), `${text}!`);
  assert.equal(await page.evaluate(value => value === undefined, undefined), true);
  assert.equal(await page.evaluate(() => undefined), undefined);
  await assert.rejects(page.evaluate(() => { throw new Error('fixture failure'); }), /fixture failure/);
  assert.ok(session.calls.every(({ method }) => !['Runtime.enable', 'Runtime.disable', 'Log.enable', 'Performance.enable'].includes(method) && !method.startsWith('Debugger.')));
  await page.dispose();
});

test('goto 不被旧文档或子 frame 的 idle 提前完成，并处理早于导航响应的事件', async () => {
  const session = new FakeSession();
  const page = await session.page();
  session.navigate = async () => {
    session.commit('https://lpt.liepin.com/search');
    session.emit('Page.frameAttached', { frameId: 'child', parentFrameId: 'main' });
    session.commit('about:blank', 'child-load', 'child', 'main');
    session.emit('Page.frameStartedLoading', { frameId: 'child' });
    session.idle('initial');
    session.idle('child-load', 'child');
    return { frameId: 'main', loaderId: 'next' };
  };
  let completed = false;
  const navigation = page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2' }).then(() => { completed = true; });
  await setImmediate();
  assert.equal(completed, false);
  session.idle();
  await navigation;
  assert.equal(page.url(), 'https://lpt.liepin.com/search');
  await page.dispose();
});

test('goto 等待已加载子 frame，分离子 frame 后可以完成', async () => {
  const session = new FakeSession();
  const page = await session.page();
  session.navigate = async () => {
    session.commit('https://lpt.liepin.com/search');
    session.emit('Page.frameAttached', { frameId: 'child', parentFrameId: 'main' });
    session.commit('https://example.test/frame', 'child-load', 'child', 'main');
    session.emit('Page.frameStartedLoading', { frameId: 'child' });
    session.idle();
    return { frameId: 'main', loaderId: 'next' };
  };
  let completed = false;
  const navigation = page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2' }).then(() => { completed = true; });
  await setImmediate();
  assert.equal(completed, false);
  session.emit('Page.frameDetached', { frameId: 'child', reason: 'remove' });
  await navigation;
  await page.dispose();
});

test('goto 跟随当前重定向文档，不用前一 loader 的 idle 完成', async () => {
  const session = new FakeSession();
  const page = await session.page();
  session.navigate = async () => {
    session.commit('https://lpt.liepin.com/search', 'next');
    session.commit('https://lpt.liepin.com/recommend', 'redirect');
    session.idle('next');
    return { frameId: 'main', loaderId: 'next' };
  };
  let completed = false;
  const navigation = page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2' }).then(() => { completed = true; });
  await setImmediate();
  assert.equal(completed, false);
  session.idle('redirect');
  await navigation;
  assert.equal(page.url(), 'https://lpt.liepin.com/recommend');
  await page.dispose();
});

test('goto 支持同文档导航，下一次 evaluate 使用当前默认文档', async () => {
  const session = new FakeSession();
  const page = await session.page();
  session.idle('initial');
  session.navigate = async ({ url }) => {
    session.emit('Page.navigatedWithinDocument', { frameId: 'main', url });
    return { frameId: 'main' };
  };
  await page.goto(`${session.frame.url}#section`, { waitUntil: 'networkidle2' });
  assert.match(page.url(), /#section$/);
  session.navigate = async ({ url }) => {
    session.globals.document = { title: 'new document' };
    session.commit(url, 'new-document');
    session.idle('new-document');
    return { frameId: 'main', loaderId: 'new-document' };
  };
  await page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2' });
  assert.equal(await page.evaluate(() => document.title), 'new document');
  const evaluations = session.calls.filter(call => call.method === 'Runtime.evaluate');
  assert.ok(evaluations.every(call => !('contextId' in call.params)));
  await page.dispose();
});

test('goto 超时、导航失败和下载不返回成功且不自动重试', async () => {
  for (const result of [
    { frameId: 'main', loaderId: 'next' },
    { frameId: 'main', errorText: 'net::ERR_ABORTED' },
    { frameId: 'main', isDownload: true },
  ]) {
    const session = new FakeSession();
    const page = await session.page();
    session.navigate = async () => result;
    await assert.rejects(page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2', timeout: 15 }));
    assert.equal(session.calls.filter(call => call.method === 'Page.navigate').length, 1);
    await page.dispose();
  }
});

test('已有 blank 页面不可恢复，只有显式新建页面允许初始 blank', async () => {
  const existing = new FakeSession();
  existing.frame.url = 'about:blank';
  await assert.rejects(existing.page(), { name: 'RiskControlError' });
  assert.equal(existing.calls.some(call => call.method === 'Page.navigate'), false);
  const fresh = new FakeSession();
  fresh.frame.url = 'about:blank';
  const page = await fresh.page({ allowInitialBlank: true });
  fresh.navigate = async ({ url }) => {
    fresh.commit(url);
    fresh.idle();
    return { frameId: 'main', loaderId: 'next' };
  };
  await page.goto('https://lpt.liepin.com/recommend', { waitUntil: 'networkidle2' });
  fresh.commit('about:blank', 'blank');
  await assert.rejects(page.evaluate(() => 1), { name: 'RiskControlError' });
  await page.dispose();
});

test('初始化清理失败不覆盖原来的页面失效错误', async () => {
  const session = new FakeSession();
  session.frame.url = 'about:blank';
  session.detach = async () => { throw new Error('Session closed during detach'); };
  await assert.rejects(session.page(), { name: 'RiskControlError' });
  assert.equal(session.eventNames().length, 0);
});

test('主 frame 短暂 blank 后恢复仍停止，子 frame blank 不触发误报', async () => {
  for (const blank of ['about:blank', 'chrome-error://chromewebdata/']) {
    const session = new FakeSession();
    const page = await session.page();
    session.commit('about:blank', 'child-load', 'child', 'main');
    assert.equal(await page.evaluate(() => 1), 1);
    session.commit(blank, 'blank');
    session.commit('https://lpt.liepin.com/recommend', 'recovered');
    const count = session.calls.length;
    await assert.rejects(page.evaluate(() => 1), { name: 'RiskControlError' });
    await assert.rejects(page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2' }), { name: 'RiskControlError' });
    await assert.rejects(page.click('button'), { name: 'RiskControlError' });
    assert.equal(session.calls.length, count);
    await page.dispose();
  }
});

test('evaluate 跨文档时失败，带副作用的回调不会自动重放', async () => {
  const session = new FakeSession();
  const page = await session.page();
  let finish!: (result: any) => void;
  session.evaluate = () => new Promise(resolve => { finish = resolve; });
  const pending = page.evaluate(() => 'request result');
  session.commit('https://lpt.liepin.com/search');
  finish({ result: { type: 'string', value: 'request result' } });
  await assert.rejects(pending, /Execution context was destroyed|页面.*导航/);
  assert.equal(session.calls.filter(call => call.method === 'Runtime.evaluate').length, 1);
  await page.dispose();
});

test('断连立即结束等待、导航和取值，dispose 只 detach', async () => {
  for (const operation of ['wait', 'goto', 'evaluate']) {
    const session = new FakeSession();
    const page = await session.page({ timeoutMs: 10000 });
    session.globals.document = { querySelector: () => null };
    if (operation === 'evaluate') session.evaluate = () => new Promise(() => {});
    const pending = operation === 'wait' ? page.waitForSelector('.missing', { timeout: 10000 })
      : operation === 'goto' ? page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2' })
      : page.evaluate(() => 1);
    const rejected = assert.rejects(pending, /closed|断开|关闭/i);
    await session.detach();
    await rejected;
    await page.dispose();
    assert.equal(page.isClosed(), true);
    assert.equal(session.eventNames().length, 0);
    assert.ok(session.calls.every(call => !['Browser.close', 'Target.closeTarget'].includes(call.method)));
  }
});

test('页面会话单独断开时挂起取值按退出码 3 停止，不等待浏览器断连', async () => {
  const session = new FakeSession();
  const page = await session.page();
  session.evaluate = () => new Promise(() => {});
  const pending = assert.rejects(page.evaluate(() => 1), { name: 'RiskControlError' });
  session.detached = true;
  session.connectionEvents.emit(CDPSessionEvent.SessionDetached, session);

  await pending;

  assert.equal(session.disconnect.signal.aborted, false);
  assert.equal(session.calls.filter(call => call.method === 'Runtime.evaluate').length, 1);
  assert.equal(session.eventNames().length, 0);
  assert.equal(session.connectionEvents.eventNames().length, 0);
  await page.dispose();
});

test('页面会话拒绝请求时仍检查断连状态，不用普通协议错误掩盖页面失效', async () => {
  const session = new FakeSession();
  const page = await session.page();
  session.evaluate = async () => {
    session.detached = true;
    throw new Error('Protocol error (Runtime.evaluate): Target closed');
  };

  await assert.rejects(page.evaluate(() => 1), { name: 'RiskControlError' });

  assert.equal(session.disconnect.signal.aborted, false);
  assert.equal(session.calls.filter(call => call.method === 'Runtime.evaluate').length, 1);
  await page.dispose();
});

test('waitForSelector 轮询 DOM，超时或导航立即停止', async () => {
  const session = new FakeSession();
  const page = await session.page();
  let visible = false;
  session.globals.document = { querySelector: () => visible ? {} : null };
  const found = page.waitForSelector('.fixture', { timeout: 1000 });
  visible = true;
  await found;
  visible = false;
  await assert.rejects(page.waitForSelector('.missing', { timeout: 15 }), /timeout|超时/i);
  const pending = page.waitForSelector('.missing', { timeout: 1000 });
  const rejected = assert.rejects(pending, /Execution context was destroyed|页面.*导航/);
  session.commit('https://lpt.liepin.com/search');
  await rejected;
  await page.dispose();
});

test('waitForSelector 的超时包含卡住的 DOM 查询', async () => {
  const session = new FakeSession();
  const page = await session.page({ timeoutMs: 1000 });
  session.evaluate = () => new Promise(() => {});
  try {
    const outcome = await Promise.race([
      page.waitForSelector('.missing', { timeout: 10 }).then(() => 'resolved', () => 'rejected'),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 100)),
    ]);
    assert.equal(outcome, 'rejected');
  } finally { await page.dispose(); }
});

test('新建页导航后再次提交 blank 也会停止', async () => {
  const session = new FakeSession();
  session.frame.url = 'about:blank';
  const page = await session.page({ allowInitialBlank: true });
  session.navigate = async () => {
    session.commit('about:blank');
    session.idle();
    return { frameId: 'main', loaderId: 'next' };
  };
  try {
    await assert.rejects(page.goto('https://lpt.liepin.com/search', { waitUntil: 'networkidle2' }), { name: 'RiskControlError' });
  } finally { await page.dispose(); }
});

test('click 使用真实 Input，检查遮挡并释放节点，不调用 DOM click', async () => {
  for (const ready of [true, false]) {
    const session = new FakeSession();
    const page = await session.page();
    session.evaluate = async () => ({ result: { type: 'object', subtype: 'node', objectId: 'node-1' } });
    session.point.ready = ready;
    if (ready) await page.click('.fixture');
    else await assert.rejects(page.click('.fixture'), /遮挡|不可|visible|click/i);
    const inputs = session.calls.filter(call => call.method === 'Input.dispatchMouseEvent');
    assert.deepEqual(inputs.map(call => call.params.type), ready ? ['mouseMoved', 'mousePressed', 'mouseReleased'] : []);
    assert.ok(session.calls.some(call => call.method === 'Runtime.releaseObject' && call.params.objectId === 'node-1'));
    await page.dispose();
  }
});

test('click 在鼠标按下前导航时停止，不向新页面发送点击', async () => {
  const session = new FakeSession();
  const page = await session.page();
  session.evaluate = async () => ({ result: { type: 'object', subtype: 'node', objectId: 'node-1' } });
  const send = session.send.bind(session);
  session.send = async (method, params) => {
    const result = await send(method, params);
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') session.commit('https://lpt.liepin.com/search');
    return result;
  };
  await assert.rejects(page.click('.fixture'), /Execution context was destroyed|页面.*导航/);
  assert.equal(session.calls.some(call => call.method === 'Input.dispatchMouseEvent' && call.params.type === 'mousePressed'), false);
  await page.dispose();
});

test('viewport 保持尺寸能力，不设置网站身份或脚本', async () => {
  const session = new FakeSession();
  const page = await session.page();
  await page.setViewport({ width: 1280, height: 800 });
  assert.ok(session.calls.some(call => call.method === 'Emulation.setDeviceMetricsOverride' && call.params.width === 1280 && call.params.height === 800));
  assert.ok(session.calls.every(call => !['Network.setUserAgentOverride', 'Page.addScriptToEvaluateOnNewDocument'].includes(call.method)));
  await page.dispose();
});
