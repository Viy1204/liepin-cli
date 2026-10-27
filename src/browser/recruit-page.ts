import { CDPSessionEvent, type CDPSession, type Connection, type Protocol } from 'puppeteer-core';
import { PageUnavailableError } from '../common/utils.js';

export interface RecruitPage {
  assertAvailable(): void;
  url(): string;
  goto(url: string, options: { waitUntil: 'networkidle2'; timeout?: number }): Promise<void>;
  evaluate<Args extends unknown[], Result>(fn: (...args: Args) => Result, ...args: Args): Promise<Awaited<Result>>;
  waitForSelector(selector: string, options: { timeout?: number }): Promise<void>;
  click(selector: string): Promise<void>;
}

type FrameState = {
  parentId?: string;
  loaderId: string;
  loading: boolean;
  idleLoaders: Set<string>;
};

type PageOptions = { allowInitialBlank?: boolean; timeoutMs?: number; signal?: AbortSignal };

export class RecruitPageSession implements RecruitPage {
  readonly #session: CDPSession;
  readonly #connection?: Connection;
  readonly #timeout: number;
  readonly #signal?: AbortSignal;
  readonly #frames = new Map<string, FrameState>();
  readonly #commits = new Map<string, number>();
  readonly #checks = new Set<() => void>();
  #rootId = '';
  #url = '';
  #version = 0;
  #sameDocumentVersion = 0;
  #allowInitialBlank: boolean;
  #closed = false;
  #fault?: Error;

  private constructor(session: CDPSession, options: PageOptions) {
    this.#session = session;
    this.#connection = session.connection();
    this.#connection?.on(CDPSessionEvent.SessionDetached, this.#onSessionDetached);
    this.#timeout = options.timeoutMs ?? 30000;
    this.#signal = options.signal;
    this.#allowInitialBlank = options.allowInitialBlank === true;
    session.on('Page.frameNavigated', this.#onFrame);
    session.on('Page.navigatedWithinDocument', this.#onSameDocument);
    session.on('Page.frameAttached', this.#onAttached);
    session.on('Page.frameDetached', this.#onDetached);
    session.on('Page.frameStartedLoading', this.#onLoading);
    session.on('Page.lifecycleEvent', this.#onLifecycle);
    this.#signal?.addEventListener('abort', this.#onDisconnected, { once: true });
    if (this.#signal?.aborted) this.#onDisconnected();
  }

  static async create(session: CDPSession, options: PageOptions = {}): Promise<RecruitPageSession> {
    const page = new RecruitPageSession(session, options);
    try {
      await page.#request(() => session.send('Page.enable'));
      const version = page.#version;
      const { frameTree } = await page.#request(() => session.send('Page.getFrameTree'));
      if (page.#version === version) page.#seedTree(frameTree);
      page.#assert();
      await page.#request(() => session.send('Page.setLifecycleEventsEnabled', { enabled: true }));
      return page;
    } catch (error) {
      try { await page.dispose(); } catch (cleanupError) {
        if (error instanceof Error) error.cause = cleanupError;
      }
      throw error;
    }
  }

  assertAvailable(): void { this.#assert(); }
  url(): string { return this.#url; }
  isClosed(): boolean { return this.#closed || this.#session.detached; }

  #frame(id: string): FrameState {
    let frame = this.#frames.get(id);
    if (!frame) {
      frame = { loaderId: '', loading: false, idleLoaders: new Set() };
      this.#frames.set(id, frame);
    }
    return frame;
  }

  #seedTree(tree: Protocol.Page.FrameTree): void {
    const frame = this.#frame(tree.frame.id);
    frame.parentId = tree.frame.parentId;
    frame.loaderId = tree.frame.loaderId;
    if (!tree.frame.parentId) {
      this.#rootId = tree.frame.id;
      this.#recordURL(tree.frame.url);
    }
    for (const child of tree.childFrames ?? []) this.#seedTree(child);
  }

  #recordURL(url: string): void {
    this.#url = url;
    if (url === 'about:blank' || url.startsWith('chrome-error://')) {
      if (url === 'about:blank' && this.#allowInitialBlank) return;
      this.#fault ??= new PageUnavailableError(
        `页面已失效（当前 ${url}），停止自动化，不要自动重试、刷新或重登；发送结果待核验，不要自动重发。`,
      );
    } else {
      this.#allowInitialBlank = false;
    }
  }

  #onFrame = ({ frame }: Protocol.Page.FrameNavigatedEvent): void => {
    if (!frame.parentId) {
      for (const id of this.#frames.keys()) if (id !== frame.id) this.#frames.delete(id);
      this.#rootId = frame.id;
      this.#version++;
      this.#commits.set(frame.loaderId, this.#version);
      this.#recordURL(frame.url);
    }
    const state = this.#frame(frame.id);
    state.parentId = frame.parentId;
    state.loaderId = frame.loaderId;
    this.#notify();
  };

  #onSameDocument = ({ frameId, url }: Protocol.Page.NavigatedWithinDocumentEvent): void => {
    if (frameId !== this.#rootId) return;
    this.#sameDocumentVersion = ++this.#version;
    this.#recordURL(url);
    this.#notify();
  };

  #onAttached = ({ frameId, parentFrameId }: Protocol.Page.FrameAttachedEvent): void => {
    this.#frame(frameId).parentId = parentFrameId;
  };

  #onDetached = ({ frameId, reason }: Protocol.Page.FrameDetachedEvent): void => {
    if (frameId === this.#rootId && reason !== 'swap') {
      this.#fault ??= new PageUnavailableError('Target closed：主页面已关闭，停止自动化，不要自动重试或重登');
    }
    const remove = (id: string): void => {
      for (const [childId, frame] of this.#frames) if (frame.parentId === id) remove(childId);
      this.#frames.delete(id);
    };
    remove(frameId);
    this.#notify();
  };

  #onLoading = ({ frameId }: Protocol.Page.FrameStartedLoadingEvent): void => {
    this.#frame(frameId).loading = true;
    this.#notify();
  };

  #onLifecycle = ({ frameId, loaderId, name }: Protocol.Page.LifecycleEventEvent): void => {
    const frame = this.#frame(frameId);
    if (name === 'init') frame.loaderId = loaderId;
    if (name === 'networkAlmostIdle') frame.idleLoaders.add(loaderId);
    this.#notify();
  };

  #onSessionDetached = (session: CDPSession): void => {
    if (session === this.#session) this.#onDisconnected();
  };

  #onDisconnected = (): void => {
    this.#closed = true;
    this.#notify();
    this.#removeListeners();
  };

  #assert(version?: number): void {
    if (this.#fault) throw this.#fault;
    if (this.isClosed()) throw new PageUnavailableError('Session closed：页面连接已断开，停止自动化，不要自动重试或重登');
    if (version !== undefined && version !== this.#version) {
      throw new PageUnavailableError('Execution context was destroyed：页面发生导航，停止自动化；发送结果待核验，不要自动重发。');
    }
  }

  #notify(): void { for (const check of [...this.#checks]) check(); }

  #request<T>(operation: () => Promise<T>, version?: number, timeout = this.#timeout): Promise<T> {
    this.#assert(version);
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error?: unknown, result?: T): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.#checks.delete(check);
        if (error) reject(error); else resolve(result as T);
      };
      const check = (): void => {
        try { this.#assert(version); } catch (error) { finish(error); }
      };
      const timer = setTimeout(() => finish(new Error('页面协议请求超时')), timeout);
      this.#checks.add(check);
      try {
        operation().then(result => { check(); finish(undefined, result); }, error => { check(); finish(error); });
      } catch (error) { check(); finish(error); }
    });
  }

  #wait(predicate: () => boolean, timeout: number, signal?: AbortSignal, version?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: unknown): void => {
        clearTimeout(timer);
        this.#checks.delete(check);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const check = (): void => {
        try { this.#assert(version); if (predicate()) finish(); } catch (error) { finish(error); }
      };
      const abort = (): void => finish(signal?.reason);
      const timer = setTimeout(() => finish(new Error(`等待页面超时（${timeout}ms）`)), timeout);
      this.#checks.add(check);
      signal?.addEventListener('abort', abort, { once: true });
      check();
    });
  }

  async goto(url: string, options: { waitUntil: 'networkidle2'; timeout?: number }): Promise<void> {
    this.#assert();
    this.#allowInitialBlank = false;
    const version = this.#version;
    const controller = new AbortController();
    let response: Protocol.Page.NavigateResponse | undefined;
    const ready = this.#wait(() => {
      if (!response) return false;
      if (response.loaderId ? (this.#commits.get(response.loaderId) ?? 0) <= version : this.#sameDocumentVersion <= version) return false;
      const root = this.#frames.get(this.#rootId);
      if (!root?.idleLoaders.has(root.loaderId)) return false;
      return [...this.#frames.values()].every(frame => !frame.parentId || !frame.loading || frame.idleLoaders.has(frame.loaderId));
    }, options.timeout ?? this.#timeout, controller.signal);
    try {
      await Promise.all([
        this.#request(() => this.#session.send('Page.navigate', { url, frameId: this.#rootId }, { timeout: options.timeout ?? this.#timeout })).then(result => {
          if (result.errorText) throw new Error(`页面导航失败：${result.errorText}`);
          if (result.isDownload) throw new Error('页面导航变成下载，未确认目标页面');
          response = result;
          this.#notify();
        }),
        ready,
      ]);
      this.#assert();
    } finally { controller.abort(); }
  }

  #expression<Args extends unknown[]>(fn: (...args: Args) => unknown, args: Args): string {
    const values = args.map(value => value === undefined ? 'undefined' : JSON.stringify(value));
    return `(${fn.toString()})(${values.join(',')})`;
  }

  #result(response: Protocol.Runtime.EvaluateResponse | Protocol.Runtime.CallFunctionOnResponse): Protocol.Runtime.RemoteObject {
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result;
  }

  async evaluate<Args extends unknown[], Result>(fn: (...args: Args) => Result, ...args: Args): Promise<Awaited<Result>> {
    return await this.#evaluate(fn, args);
  }

  async #evaluate<Args extends unknown[], Result>(fn: (...args: Args) => Result, args: Args, timeout = this.#timeout): Promise<Awaited<Result>> {
    const version = this.#version;
    const response = await this.#request(() => this.#session.send('Runtime.evaluate', {
      expression: this.#expression(fn, args), returnByValue: true, awaitPromise: true,
    }, { timeout }), version, timeout);
    this.#assert(version);
    const result = this.#result(response);
    if (result.type === 'undefined') return undefined as Awaited<Result>;
    return result.value as Awaited<Result>;
  }

  async waitForSelector(selector: string, options: { timeout?: number }): Promise<void> {
    const version = this.#version;
    const deadline = Date.now() + (options.timeout ?? this.#timeout);
    while (true) {
      this.#assert(version);
      const found = await this.#evaluate(value => document.querySelector(value) !== null, [selector], Math.max(1, deadline - Date.now()));
      this.#assert(version);
      if (found) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`等待元素超时：${selector}`);
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => { clearTimeout(timer); this.#checks.delete(check); };
        const check = (): void => {
          try { this.#assert(version); } catch (error) { cleanup(); reject(error); }
        };
        const timer = setTimeout(() => { cleanup(); resolve(); }, Math.min(100, remaining));
        this.#checks.add(check);
        check();
      });
    }
  }

  async click(selector: string): Promise<void> {
    const version = this.#version;
    const response = await this.#request(() => this.#session.send('Runtime.evaluate', {
      expression: this.#expression(value => document.querySelector(value), [selector]), returnByValue: false,
    }), version);
    this.#assert(version);
    const node = this.#result(response);
    if (node.subtype !== 'node' || !node.objectId) throw new Error(`找不到可点击元素：${selector}`);
    try {
      await this.#request(() => this.#session.send('DOM.scrollIntoViewIfNeeded', { objectId: node.objectId }), version);
      const geometry = async () => {
        const result = await this.#request(() => this.#session.send('Runtime.callFunctionOn', {
          objectId: node.objectId,
          functionDeclaration: `function() {
            const rect = this.getBoundingClientRect();
            const style = getComputedStyle(this);
            const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
            const top = document.elementFromPoint(x, y);
            return { x, y, ready: this.isConnected && rect.width > 0 && rect.height > 0 &&
              style.display !== 'none' && style.visibility !== 'hidden' && !!top && (top === this || this.contains(top)) };
          }`, returnByValue: true,
        }), version);
        this.#assert(version);
        const point = this.#result(result).value as { x: number; y: number; ready: boolean };
        if (!point.ready) throw new Error(`元素不可见或被遮挡，取消点击：${selector}`);
        return point;
      };
      const point = await geometry();
      await this.#request(() => this.#session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }), version);
      const checked = await geometry();
      if (Math.abs(point.x - checked.x) > 0.5 || Math.abs(point.y - checked.y) > 0.5) throw new Error('元素位置发生变化，取消点击');
      for (const type of ['mousePressed', 'mouseReleased'] as const) {
        await this.#request(() => this.#session.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 }), version);
      }
      this.#assert(version);
    } finally {
      if (!this.#session.detached) {
        await this.#session.send('Runtime.releaseObject', { objectId: node.objectId }).catch(error => {
          if (!/Cannot find object|Cannot find context|Execution context|closed|detached/i.test(String(error))) throw error;
        });
      }
    }
  }

  async setViewport({ width, height }: { width: number; height: number }): Promise<void> {
    await this.#request(() => this.#session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }));
  }

  #removeListeners(): void {
    this.#connection?.off(CDPSessionEvent.SessionDetached, this.#onSessionDetached);
    this.#session.off('Page.frameNavigated', this.#onFrame);
    this.#session.off('Page.navigatedWithinDocument', this.#onSameDocument);
    this.#session.off('Page.frameAttached', this.#onAttached);
    this.#session.off('Page.frameDetached', this.#onDetached);
    this.#session.off('Page.frameStartedLoading', this.#onLoading);
    this.#session.off('Page.lifecycleEvent', this.#onLifecycle);
    this.#signal?.removeEventListener('abort', this.#onDisconnected);
  }

  async dispose(): Promise<void> {
    this.#onDisconnected();
    if (!this.#session.detached) await this.#session.detach();
  }
}
