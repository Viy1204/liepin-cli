import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { connectMinimalPage } from './minimal-ui-driver.mjs';
import { clickStableTarget } from './stable-click.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const closeSelectors = ['[data-tlg-elem-id="b_pc_pop_res_detail_close_btn"]', '[class*="closeBtn"]', '[class*="closeIcon"]'];
const commands = new Set(['open-card-preview', 'close-preview', 'mapping-search-once']);

export class SafetyStop extends Error {
  exitCode = 3;
}

function safeURL(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export async function runController({ command, value, browserURL, observeMs = 0, onCommand }, { connect = connectMinimalPage, wait = sleep } = {}) {
  if (!commands.has(command)) throw new Error('Unsupported experimental command');
  if (!Number.isInteger(observeMs) || observeMs < 0 || observeMs > 60000) throw new Error('observe-ms must be between 0 and 60000');
  if (command === 'open-card-preview' && value && !/^[A-Za-z0-9]+$/.test(value)) throw new Error('Invalid encoded resume ID');
  if (command === 'mapping-search-once' && (!value?.trim() || value.trim().length > 100)) throw new Error('Search query must contain 1 to 100 characters');
  let faultSeen;
  let page;
  let connection;
  const recordFault = url => {
    const parsed = new URL(url);
    if (url === 'about:blank' || parsed.hostname === 'safe.liepin.com' || /(?:^|[./_-])(?:login|signin|passport)(?:[./_-]|$)/i.test(`${parsed.hostname}${parsed.pathname}`)) {
      faultSeen ||= new SafetyStop('Blank, safety, or login page observed; stop and inspect the browser manually');
    } else if (parsed.protocol !== 'https:' || parsed.hostname !== 'lpt.liepin.com') {
      faultSeen ||= new SafetyStop('Page left the expected recruiter origin; stopped');
    }
  };
  const assertAlive = () => {
    if (page) recordFault(page.url());
    if (faultSeen) throw faultSeen;
  };
  const checked = async operation => { assertAlive(); const result = await operation(); assertAlive(); return result; };
  const visibleCloseControls = async () => {
    for (const selector of closeSelectors) {
      const visible = [];
      for (const control of await checked(() => page.$$(selector))) {
        if (await checked(() => control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }))) visible.push(control);
      }
      if (visible.length) return visible;
    }
    return [];
  };
  const click = target => checked(() => clickStableTarget(page, target, { expectedUrl: page.url(), sleep: wait }));
  const requirePath = path => {
    if (new URL(page.url()).pathname.replace(/\/$/, '') !== path) throw new Error(`Command requires ${path}`);
  };
  try {
    connection = await connect({ browserURL, onNavigation: recordFault, onCommand: method => { assertAlive(); onCommand?.(method); } });
    page = connection.page;
    page.on('framenavigated', frame => { if (!frame.parentFrame()) recordFault(frame.url()); });
    assertAlive();
    if (command === 'open-card-preview') {
      requirePath('/recommend');
      const handle = await checked(() => page.evaluateHandle(id => {
        const cards = [...document.querySelectorAll('.xpath-resume-item-wrap')].filter(card => {
          if (!id) { const rect = card.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
          try { return JSON.parse(decodeURIComponent(card.getAttribute('data-tlg-ext') || '')).encodeResId === id; } catch { return false; }
        });
        return (id ? cards.length === 1 : cards.length > 0) ? cards[0].querySelector('.nest-resume-personal-name') : null;
      }, value || ''));
      const target = handle.asElement();
      if (!target) throw new Error('No unique resume target');
      await click(target);
      await checked(() => wait(1800));
      if (!(await visibleCloseControls()).length) throw new Error('Resume preview did not open');
    } else if (command === 'close-preview') {
      requirePath('/recommend');
      const controls = await visibleCloseControls();
      if (controls.length > 1) throw new Error('Resume close control is not unique');
      if (controls.length === 1) { await click(controls[0]); await checked(() => wait(1200)); }
      for (let sample = 0; sample < 3; sample++) {
        requirePath('/recommend');
        if ((await visibleCloseControls()).length) throw new Error('Resume preview remains open; no retry');
        if (!(await checked(() => page.$$('.xpath-resume-item-wrap'))).length) throw new Error('Recommendation content missing after close');
        if (sample < 2) await checked(() => wait(300));
      }
    } else {
      requirePath('/search');
      const query = value.trim();
      const inputs = await checked(() => page.$$('input[placeholder^="搜职位/公司/行业"]'));
      if (inputs.length !== 1) throw new Error('Search input is not unique');
      await click(inputs[0]);
      const session = await checked(() => page.createCDPSession());
      try {
        await checked(() => session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', commands: ['selectAll'] }));
        await checked(() => session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' }));
        await checked(() => page.keyboard.press('Backspace'));
        await checked(() => session.send('Input.insertText', { text: query }));
      } finally { await session.detach(); }
      if (await checked(() => inputs[0].evaluate(element => element.value)) !== query) throw new Error('Search query was not replaced; no submission');
      await checked(() => page.keyboard.press('Escape'));
      await checked(() => page.keyboard.press('Tab'));
      await checked(() => wait(350));
      const handle = await checked(() => page.evaluateHandle(() => {
        const matches = [...document.querySelectorAll('button')].filter(element => element.textContent.trim() === '搜索' && element.getBoundingClientRect().width > 0);
        return matches.length === 1 ? matches[0] : null;
      }));
      const target = handle.asElement();
      if (!target) throw new Error('Search button is not unique');
      await checked(() => page.mouse.move(20, 400));
      await checked(() => wait(900));
      await checked(() => clickStableTarget(page, target, { expectedUrl: page.url(), relativeY: 0.15, sleep: wait }));
      await checked(() => wait(2200));
    }
    const deadline = Date.now() + observeMs;
    while (Date.now() < deadline) await checked(() => wait(Math.min(250, deadline - Date.now())));
    const summary = await checked(() => page.evaluate(() => ({
      bodyLength: (document.body?.innerText || '').trim().length,
      searchValue: document.querySelector('input[placeholder^="搜职位/公司/行业"]')?.value || '',
      resultCards: document.querySelectorAll('li[data-resumeidencode]').length,
    })));
    if (!summary.bodyLength) throw new Error('Page body is empty; operation not confirmed');
    const visibleClose = (await visibleCloseControls()).length;
    assertAlive();
    return { command, url: safeURL(page.url()), ...summary, visibleClose };
  } catch (error) {
    if (faultSeen) throw faultSeen;
    throw error;
  } finally { if (connection) await connection.disconnect(); }
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    'browser-url': { type: 'string' }, 'observe-ms': { type: 'string', default: '0' }, 'trace-methods': { type: 'boolean', default: false },
  } });
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('This experimental controller requires Node.js 24 or later');
  if (!values['browser-url']) throw new Error('Provide --browser-url for an existing browser');
  if (positionals.length < 1 || positionals.length > 2) throw new Error('Expected command and optional ID or search query');
  const methodCounts = {};
  try {
    const result = await runController({ command: positionals[0], value: positionals[1], browserURL: values['browser-url'], observeMs: Number(values['observe-ms']),
      onCommand: values['trace-methods'] ? method => { methodCounts[method] = (methodCounts[method] || 0) + 1; } : undefined });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { if (values['trace-methods']) process.stderr.write(`${JSON.stringify({ methodCounts })}\n`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = error.exitCode === 3 ? 3 : 1;
  });
}
