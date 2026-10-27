import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer-core';
import { config } from '../../dist/config.js';
import { getCapturedLogs, setLogCapture } from 'puppeteer-core/lib/esm/puppeteer/common/Debug.js';

assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'This isolated verification script requires Node.js 24 or later');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rawSession(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function probe(mode) {
  const profile = await mkdtemp(join(tmpdir(), 'liepin-subscription-'));
  const chrome = spawn(config.chromePath, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  let root;
  let browser;
  let session;
  let adapter;
  try {
    let port;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (port) break;
      await sleep(100);
    }
    assert.ok(port, 'Isolated Chrome should expose its debugging port');
    const origin = `http://127.0.0.1:${port}`;
    const version = await (await fetch(`${origin}/json/version`)).json();
    root = await rawSession(version.webSocketDebuggerUrl);
    const targets = await (await fetch(`${origin}/json/list`)).json();
    setLogCapture(true);
    if (mode === 'raw') {
      session = await rawSession(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    } else {
      browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl, defaultViewport: null });
      if (mode === 'page') {
        const page = (await browser.pages())[0];
        session = await page.createCDPSession();
      } else {
        session = await browser.targets().find(t => t.type() === 'page').createCDPSession();
      }
    }
    const url = new URL('./subscription-fixture.html', import.meta.url).href;
    let result;
    if (mode === 'adapter') {
      const { RecruitPageSession } = await import('../../dist/browser/recruit-page.js');
      const disconnected = new AbortController();
      browser.once('disconnected', () => disconnected.abort());
      adapter = await RecruitPageSession.create(session, { allowInitialBlank: true, signal: disconnected.signal });
      await adapter.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
      await adapter.waitForSelector('#increment', { timeout: 2000 });
      await adapter.click('#increment');
      const count = await adapter.evaluate(() => document.querySelector('#count').textContent);
      assert.equal(count, '1', 'A single click should increment once');
      const argsResult = await adapter.evaluate(async (text, value) => ({ text, missing: value === undefined }), 'quoted " \\ 中文', undefined);
      assert.deepEqual(argsResult, { text: 'quoted " \\ 中文', missing: true });
      await adapter.goto(`${url}#next`, { waitUntil: 'networkidle2', timeout: 3000 });
      assert.ok(adapter.url().endsWith('#next'));
      await assert.rejects(adapter.evaluate(() => { throw new Error('fixture exception'); }), /fixture exception/);
      await adapter.evaluate(() => window.runProbe());
      result = { result: { value: { bodyPresent: true, clickedOnce: true, argsPreserved: true, sameDocumentNavigation: true, exceptionsPreserved: true } } };
    } else {
      await session.send('Page.enable');
      await session.send('Page.navigate', { url });
      for (let i = 0; i < 50; i++) {
        const ready = await session.send('Runtime.evaluate', { expression: 'typeof window.runProbe', returnByValue: true });
        if (ready.result?.value === 'function') break;
        await sleep(100);
      }
      await session.send('Runtime.evaluate', { expression: 'window.runProbe()', returnByValue: true });
      result = await session.send('Runtime.evaluate', { expression: '({bodyPresent:Boolean(document.body?.innerText.length)})', returnByValue: true });
    }
    const methods = getCapturedLogs().filter(line => line.includes('SEND')).flatMap(line => {
      const encoded = line.match(/"method"\s*:\s*"([^"]+)"/);
      return encoded ? [encoded[1]] : [];
    });
    const subscriptions = Object.fromEntries(['Runtime.enable', 'Log.enable', 'Performance.enable', 'Debugger.enable'].map(method => [method, methods.filter(value => value === method).length]));
    setLogCapture(false);
    if (adapter) {
      const pending = adapter.waitForSelector('#does-not-exist', { timeout: 10000 });
      const stopped = assert.rejects(pending, /closed|断开|关闭/i);
      browser.disconnect();
      await stopped;
      result.result.value.disconnectStopsWaiting = true;
    }
    return { mode, ...result.result.value, subscriptions };
  } finally {
    if (adapter) await adapter.dispose();
    else if (session?.detach) await session.detach();
    else session?.close();
    if (browser) browser.disconnect();
    if (root) {
      await root.send('Browser.close').catch(error => {
        if (!/closed|timed out/i.test(error.message)) throw error;
      });
      root.close();
    }
    if (chrome.exitCode === null) chrome.kill();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function productionProbe() {
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  assert.notEqual(port, 53471, 'Production probe must use an isolated port');
  const profile = await mkdtemp(join(tmpdir(), 'liepin-production-page-'));
  process.env.LIEPIN_BROWSER_REMOTE_DEBUGGING_PORT = String(port);
  const { CdpBrowser, closeRemoteBrowser } = await import('../../dist/browser/cdp_browser.js');
  const controller = new CdpBrowser({ userDataDir: profile, headless: false });
  try {
    setLogCapture(true);
    const page = await controller.launch();
    await page.goto(new URL('./subscription-fixture.html', import.meta.url).href, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.click('#increment');
    assert.equal(await page.evaluate(() => document.querySelector('#count').textContent), '1');
    const methods = getCapturedLogs().filter(line => line.includes('SEND')).flatMap(line => {
      const found = line.match(/"method"\s*:\s*"([^"]+)"/);
      return found ? [found[1]] : [];
    });
    const subscriptions = Object.fromEntries(['Runtime.enable', 'Log.enable', 'Performance.enable', 'Debugger.enable'].map(method => [method, methods.filter(value => value === method).length]));
    setLogCapture(false);
    return { mode: 'production', isolatedPort: port, initialBrowserCreated: true, clickedOnce: true, subscriptions };
  } finally {
    controller.disconnect();
    await closeRemoteBrowser(port);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['manual', 'page', 'adapter', 'production']) {
  assert.ok(['raw', 'manual', 'page', 'adapter', 'production'].includes(mode), 'Unsupported probe mode');
  const result = mode === 'production' ? await productionProbe() : await probe(mode);
  console.log(JSON.stringify(result));
  assert.equal(result.subscriptions['Runtime.enable'], mode === 'page' ? 1 : 0);
  assert.equal(result.subscriptions['Log.enable'], mode === 'page' ? 1 : 0);
  assert.equal(result.subscriptions['Performance.enable'], mode === 'page' ? 1 : 0);
  assert.equal(result.subscriptions['Debugger.enable'], 0);
}
