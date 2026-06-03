#!/usr/bin/env node
/**
 * 抓取 lpt.liepin.com 搜索接口的真实 payload/response
 *
 * 用法:
 *   export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
 *   node scripts/capture-search.mjs
 *
 * 步骤:
 *   1. 浏览器打开 lpt.liepin.com
 *   2. 如果没登录，手动登录（cookie 会持久化到 user-data dir）
 *   3. 在浏览器里手动搜索任意关键词 (例如 "前端工程师")
 *   4. 看到职位列表后, 回到终端按 Ctrl+C
 *   5. 输出 ~/.liepin-cli/captures/search-capture-<timestamp>.json
 *
 * 然后把 JSON 内容贴给 Claude, Claude 对比 search.ts 现有实现，发现差异。
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CHROME = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
if (!CHROME) {
  console.error('错误: 未设置 CHROME_PATH');
  console.error('  export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"');
  process.exit(1);
}

const USER_DATA_DIR = process.env.LIEPIN_USER_DATA_DIR || join(homedir(), '.liepin-cli', 'user-data');
const OUTPUT_DIR = join(homedir(), '.liepin-cli', 'captures');
mkdirSync(USER_DATA_DIR, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

/** 业务接口关键词：覆盖所有命令，不只 search */
const BIZ_RE = /search|jobcard|pc-search|recommend|talent|resume|company|chat|im|contact|greet|apply|jobmanage|job\b/i;
const LATEST_FILE = join(OUTPUT_DIR, 'latest-capture.json');

/** 落盘（SIGINT 最终版 + tick 增量版共用） */
function dump(file) {
  const all = Array.from(captures.values());
  const bizLike = all.filter(c => BIZ_RE.test(c.url) || (c.postData && BIZ_RE.test(c.postData)));
  writeFileSync(file, JSON.stringify({
    capturedAt: new Date().toISOString(),
    userDataDir: USER_DATA_DIR,
    totalRequests: all.length,
    searchRelated: bizLike.length,
    all,
    searchRelatedCalls: bizLike,
  }, null, 2));
  return { all, bizLike };
}

console.log('启动 Chrome...');
console.log(`  user-data-dir: ${USER_DATA_DIR}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  userDataDir: USER_DATA_DIR,
  headless: false,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

/** 抓到的所有 XHR/Fetch 请求, 按 url 索引 */
const captures = new Map();

await page.setRequestInterception(true);
page.on('request', req => {
  if (['xhr', 'fetch'].includes(req.resourceType())) {
    captures.set(req.url(), {
      method: req.method(),
      url: req.url(),
      postData: req.postData(),
      requestHeaders: req.headers(),
      responseStatus: null,
      responseHeaders: null,
      responseBody: null,
      capturedAt: new Date().toISOString(),
    });
  }
  req.continue();
});

page.on('response', async res => {
  const cap = captures.get(res.url());
  if (!cap) return;
  cap.responseStatus = res.status();
  cap.responseHeaders = res.headers();
  try {
    cap.responseBody = await res.text();
  } catch (e) {
    cap.responseBody = `[error reading body: ${e.message}]`;
  }
});

console.log('\n打开 lpt.liepin.com ...');
await page.goto('https://lpt.liepin.com', { waitUntil: 'domcontentloaded' });

console.log('\n================================================================');
console.log('  在浏览器中:');
console.log('  1. 如果看到登录页, 请手动登录猎聘招聘者端');
console.log('  2. 登录后, 在搜索框输入任意关键词 (例如 "前端工程师")');
console.log('  3. 触发搜索, 看到职位列表后, 回到终端按 Ctrl+C');
console.log('================================================================\n');

/** Ctrl+C 处理 */
let exiting = false;
const onSigint = async () => {
  if (exiting) return;
  exiting = true;
  console.log('\n\n收到 SIGINT, 正在输出捕获数据 ...');

  const outFile = join(OUTPUT_DIR, `search-capture-${Date.now()}.json`);
  const { all, bizLike: searchLike } = dump(outFile);
  dump(LATEST_FILE);

  console.log(`\n=== 共抓到 ${all.length} 个 XHR/Fetch 请求 ===`);
  console.log(`=== 其中 ${searchLike.length} 个看起来跟业务接口相关 ===\n`);

  // 控制台打印业务相关的简要信息
  searchLike.forEach((c, i) => {
    console.log(`[${i + 1}] ${c.method} ${c.responseStatus} ${c.url}`);
  });
  
  console.log(`\n完整数据写入: ${outFile}`);
  console.log(`\n把文件内容贴给 Claude, 命令:`);
  console.log(`  cat ${outFile} | pbcopy`);
  console.log(`  # 或:`);
  console.log(`  cat ${outFile}`);
  
  await browser.close();
  process.exit(0);
};
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigint);

// 持续运行, 每 3 秒增量落盘 latest-capture.json (不依赖 Ctrl+C, 随时可读)
let tickCount = 0;
const tick = setInterval(() => {
  tickCount++;
  const { all, bizLike } = dump(LATEST_FILE);
  if (tickCount % 4 === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] 累计 ${all.length} 个请求 (${bizLike.length} 个业务接口), 已增量写入 ${LATEST_FILE}`);
  }
}, 3000);

// 防止 node 退出
process.stdin.resume();
