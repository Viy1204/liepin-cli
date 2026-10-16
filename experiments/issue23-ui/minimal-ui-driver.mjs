import { EventEmitter } from 'node:events';

const methods = new Set([
  'Page.enable', 'Page.getFrameTree', 'Runtime.evaluate', 'Runtime.callFunctionOn',
  'Runtime.getProperties', 'Runtime.releaseObject', 'DOM.scrollIntoViewIfNeeded',
  'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText',
]);

export async function connectMinimalPage({ browserURL, allowedOrigin, onCommand, onNavigation, timeoutMs = 10000 }) {
  const endpoint = new URL(browserURL);
  if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('Expected a local browser debugging endpoint');
  }
  if (allowedOrigin) {
    const origin = new URL(allowedOrigin);
    if (origin.origin !== allowedOrigin || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
      throw new Error('Offline origin must be an explicit localhost origin');
    }
  }
  const response = await fetch(new URL('/json/list', endpoint), { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Target discovery failed: ${response.status}`);
  const discovered = await response.json();
  const targets = discovered.filter(target => {
    if (target.type !== 'page') return false;
    try {
      const url = new URL(target.url);
      return allowedOrigin ? url.origin === allowedOrigin : url.protocol === 'https:' && ['lpt.liepin.com', 'safe.liepin.com'].includes(url.hostname);
    } catch { return false; }
  });
  if (targets.length !== 1) {
    if (!allowedOrigin && targets.length === 0 && discovered.filter(target => target.type === 'page').length === 1 && discovered.some(target => target.type === 'page' && target.url === 'about:blank')) {
      const error = new Error('Only page is about:blank; stopped without connecting');
      error.exitCode = 3;
      throw error;
    }
    throw new Error(`Expected exactly one matching page, found ${targets.length}`);
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  let state = 'connecting';
  let rootId;
  let currentURL = targets[0].url;
  const page = new EventEmitter();
  const rejectPending = error => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    } else if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) {
      rootId = message.params.frame.id;
      currentURL = message.params.frame.url;
      const url = currentURL;
      onNavigation?.(url);
      page.emit('framenavigated', { url: () => url, parentFrame: () => null });
    } else if (message.method === 'Page.navigatedWithinDocument' && message.params.frameId === rootId) {
      currentURL = message.params.url;
      const url = currentURL;
      onNavigation?.(url);
      page.emit('framenavigated', { url: () => url, parentFrame: () => null });
    }
  });
  ws.addEventListener('close', () => {
    state = 'disconnected';
    rejectPending(new Error('Page connection closed'));
  });
  ws.addEventListener('error', () => rejectPending(new Error('Page WebSocket failed')));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('Page connection timed out')); }, timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); state = 'connected'; resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Page connection failed')); }, { once: true });
  });
  const send = (method, params = {}) => {
    if (!methods.has(method)) return Promise.reject(new Error(`Unsupported CDP method: ${method}`));
    if (state !== 'connected') return Promise.reject(new Error('Page connection is disconnected'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      try {
        onCommand?.(method);
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  };
  const disconnect = async () => {
    if (state === 'disconnected') return;
    state = 'disconnected';
    rejectPending(new Error('Page connection disconnected'));
    ws.close();
  };
  const readResult = result => {
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result;
  };
  const expression = (fn, args) => {
    if (typeof fn !== 'function') throw new TypeError('Expected a trusted function');
    return `(${fn.toString()})(...${JSON.stringify(args)})`;
  };
  const makeHandle = remote => ({
    asElement() { return remote.subtype === 'node' ? this : null; },
    async evaluate(fn, ...args) {
      if (!remote.objectId) throw new Error('Handle has no remote object');
      if (typeof fn !== 'function') throw new TypeError('Expected a trusted function');
      const result = await send('Runtime.callFunctionOn', {
        objectId: remote.objectId,
        functionDeclaration: `function(...args) { return (${fn.toString()})(this, ...args); }`,
        arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true,
      });
      return readResult(result).value;
    },
    async scrollIntoView() {
      if (remote.subtype !== 'node') throw new Error('Handle is not an element');
      await send('DOM.scrollIntoViewIfNeeded', { objectId: remote.objectId });
    },
    async dispose() { if (remote.objectId) await send('Runtime.releaseObject', { objectId: remote.objectId }); },
  });
  page.url = () => currentURL;
  page.evaluate = async (fn, ...args) => readResult(await send('Runtime.evaluate', {
    expression: expression(fn, args), returnByValue: true, awaitPromise: true,
  })).value;
  page.evaluateHandle = async (fn, ...args) => makeHandle(readResult(await send('Runtime.evaluate', {
    expression: expression(fn, args), returnByValue: false, awaitPromise: true,
  })));
  page.$ = async selector => (await page.evaluateHandle(selector => document.querySelector(selector), selector)).asElement();
  page.$$ = async selector => {
    const remote = readResult(await send('Runtime.evaluate', {
      expression: expression(selector => [...document.querySelectorAll(selector)], [selector]), returnByValue: false,
    }));
    try {
      const properties = await send('Runtime.getProperties', { objectId: remote.objectId, ownProperties: true });
      return properties.result.filter(property => /^(0|[1-9]\d*)$/.test(property.name))
        .sort((a, b) => Number(a.name) - Number(b.name)).map(property => makeHandle(property.value));
    } finally { await send('Runtime.releaseObject', { objectId: remote.objectId }); }
  };
  page.title = () => page.evaluate(() => document.title);
  page.mouse = {
    move: (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
  };
  page.keyboard = {
    async press(key) {
      const codes = { Backspace: 8, Escape: 27, Tab: 9 };
      if (!Object.hasOwn(codes, key)) throw new Error(`Unsupported key: ${key}`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key] });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] });
    },
  };
  page.createCDPSession = async () => {
    let attached = true;
    return {
      send(method, params) {
        if (!attached) return Promise.reject(new Error('Input session detached'));
        if (!['Input.dispatchKeyEvent', 'Input.insertText'].includes(method)) return Promise.reject(new Error(`Unsupported input method: ${method}`));
        return send(method, params);
      },
      async detach() { attached = false; },
    };
  };
  try {
    await send('Page.enable');
    const { frameTree } = await send('Page.getFrameTree');
    rootId = frameTree.frame.id;
    currentURL = frameTree.frame.url;
    return { page, disconnect };
  } catch (error) { await disconnect(); throw error; }
}
