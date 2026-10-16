import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import vm from 'node:vm';
import test from 'node:test';
import { connectMinimalPage } from './minimal-ui-driver.mjs';
import { runController, SafetyStop } from './controller.mjs';

function fixture(initialURL = 'https://lpt.liepin.com/recommend?private=id') {
  const page = new EventEmitter();
  const state = { url: initialURL, preview: false, input: '', searches: [], clicks: 0, disconnected: 0 };
  const makeElement = (kind, index) => ({
    kind, textContent: kind === 'search' ? '搜索' : kind,
    get value() { return state.input; },
    isConnected: true, contains: other => other?.kind === kind,
    getBoundingClientRect: () => ({ x: index * 100, y: 0, width: 40, height: 40 }),
  });
  const elements = { name: makeElement('name', 1), close: makeElement('close', 2), input: makeElement('input', 3), search: makeElement('search', 4) };
  const card = { ...makeElement('card', 5), querySelector: () => elements.name, getAttribute: () => encodeURIComponent('{"encodeResId":"privateCandidate"}') };
  const document = {
    body: { innerText: 'Synthetic resume content that must never appear in output' },
    querySelectorAll(selector) {
      if (selector === '.xpath-resume-item-wrap') return [card];
      if (selector.startsWith('input[')) return [elements.input];
      if (selector === 'button') return [elements.search];
      if (selector === 'li[data-resumeidencode]') return [];
      if (selector.includes('close') && state.preview) return [elements.close];
      return [];
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    elementFromPoint(x) { return Object.values(elements).find(element => Math.abs(element.getBoundingClientRect().x + 20 - x) < 1); },
  };
  const evaluate = (fn, args) => vm.runInNewContext(`(${fn.toString()})(...args)`, { args, document, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
  const handle = element => ({
    asElement() { return element ? this : null; },
    evaluate: async (fn, ...args) => evaluate(fn, [element, ...args]),
    scrollIntoView: async () => {},
  });
  page.url = () => state.url;
  page.evaluate = async (fn, ...args) => evaluate(fn, args);
  page.evaluateHandle = async (fn, ...args) => handle(evaluate(fn, args));
  page.$$ = async selector => document.querySelectorAll(selector).map(handle);
  page.mouse = { move: async () => {}, click: async x => {
    state.clicks++;
    const element = document.elementFromPoint(x);
    if (element?.kind === 'name') state.preview = true;
    if (element?.kind === 'close') state.preview = false;
    if (element?.kind === 'search') state.searches.push(state.input);
  } };
  page.keyboard = { press: async key => { if (key === 'Backspace') state.input = ''; } };
  page.createCDPSession = async () => ({ send: async (method, params) => { if (method === 'Input.insertText') state.input = params.text; }, detach: async () => {} });
  const connect = async options => {
    state.options = options;
    return { page, disconnect: async () => { state.disconnected++; } };
  };
  const navigate = url => {
    state.url = url;
    state.options?.onNavigation(url);
    page.emit('framenavigated', { parentFrame: () => null, url: () => url });
  };
  return { page, state, connect, navigate };
}

test('controller opens and closes preview, and returns only a summary', async () => {
  const f = fixture();
  const opened = await runController({ command: 'open-card-preview', browserURL: 'unused' }, { connect: f.connect, wait: async () => {} });
  assert.equal(opened.visibleClose, 1);
  assert.equal(opened.url, 'https://lpt.liepin.com/recommend');
  assert.equal(f.state.disconnected, 1);
  const closed = await runController({ command: 'close-preview', browserURL: 'unused' }, { connect: f.connect, wait: async () => {} });
  assert.equal(closed.visibleClose, 0);
  assert.equal(f.state.clicks, 2);
  assert.equal(f.state.disconnected, 2);
  assert.ok(!JSON.stringify(opened).includes('Synthetic resume'));
  assert.ok(!JSON.stringify(opened).includes('privateCandidate'));
});

test('controller replaces search text twice through ordinary input', async () => {
  const f = fixture('https://lpt.liepin.com/search');
  for (const value of ['first 动画', 'second "quoted" \\']) {
    const result = await runController({ command: 'mapping-search-once', value, browserURL: 'unused' }, { connect: f.connect, wait: async () => {} });
    assert.equal(result.searchValue, value);
  }
  assert.deepEqual(f.state.searches, ['first 动画', 'second "quoted" \\']);
  assert.equal(f.state.disconnected, 2);
});

test('blank, safety, login and transient faults stop further actions and disconnect', async () => {
  for (const url of ['about:blank', 'https://safe.liepin.com/captchaPage_PC', 'https://lpt.liepin.com/login']) {
    const f = fixture(url);
    await assert.rejects(runController({ command: 'open-card-preview', browserURL: 'unused' }, { connect: f.connect, wait: async () => {} }), SafetyStop);
    assert.equal(f.state.clicks, 0);
    assert.equal(f.state.disconnected, 1);
  }
  const f = fixture();
  let waits = 0;
  await assert.rejects(runController({ command: 'open-card-preview', browserURL: 'unused' }, { connect: f.connect, wait: async () => {
    if (++waits === 1) { f.navigate('about:blank'); f.navigate('https://lpt.liepin.com/recommend'); }
  } }), SafetyStop);
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.disconnected, 1);
});

test('invalid inputs and unsupported commands never connect', async () => {
  const connect = async () => { throw new Error('Unexpected connection'); };
  for (const options of [
    { command: 'greet' }, { command: 'open-card-preview', value: '<bad>' },
    { command: 'mapping-search-once', value: '' }, { command: 'close-preview', observeMs: 60001 },
  ]) await assert.rejects(runController(options, { connect }), error => !error.message.includes('Unexpected connection'));
});

test('protocol adapter rejects ambiguous pages, limits domains and clears pending on disconnect', async t => {
  let targets = [];
  const server = http.createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(targets)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const browserURL = `http://127.0.0.1:${server.address().port}`;
  const target = { type: 'page', url: 'https://lpt.liepin.com/recommend', webSocketDebuggerUrl: 'ws://127.0.0.1/fake' };
  targets = [target, target];
  await assert.rejects(connectMinimalPage({ browserURL }), /found 2/);
  targets = [{ ...target, url: 'about:blank' }];
  await assert.rejects(connectMinimalPage({ browserURL }), error => error.exitCode === 3);
  targets = [];
  await assert.rejects(connectMinimalPage({ browserURL }), /found 0/);
  targets = [target];
  const methods = [];
  let socket;
  class FakeWebSocket extends EventTarget {
    constructor() { super(); socket = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(raw) {
      const request = JSON.parse(raw);
      methods.push(request.method);
      if (request.method === 'Runtime.evaluate') return;
      const result = request.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'root', url: target.url } } } : {};
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id, result }) })));
    }
    close() { queueMicrotask(() => this.dispatchEvent(new Event('close'))); }
  }
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => { globalThis.WebSocket = originalWebSocket; });
  const { page, disconnect } = await connectMinimalPage({ browserURL, timeoutMs: 20 });
  assert.deepEqual(methods, ['Page.enable', 'Page.getFrameTree']);
  await assert.rejects(page.title(), /timed out/);
  const session = await page.createCDPSession();
  await assert.rejects(session.send('Runtime.enable'), /Unsupported/);
  await assert.rejects(session.send('Debugger.enable'), /Unsupported/);
  const navigation = once(page, 'framenavigated');
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: 'Page.frameNavigated', params: { frame: { id: 'root', url: 'about:blank' } } }) }));
  assert.equal((await navigation)[0].url(), 'about:blank');
  assert.equal(page.url(), 'about:blank');
  const pending = assert.rejects(page.title(), /disconnected/);
  await disconnect();
  await pending;
  await assert.rejects(page.title(), /disconnected/);
  assert.ok(methods.every(method => !['Runtime.enable', 'Runtime.disable', 'Browser.close', 'Target.closeTarget'].includes(method) && !method.startsWith('Debugger.')));
});
