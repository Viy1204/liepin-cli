#!/usr/bin/env node
/**
 * 分析 capture-search.mjs 抓到的 JSON, 找到真实的搜索接口调用并对比 search.ts 现有实现.
 *
 * 用法:
 *   node scripts/analyze-capture.mjs ~/.liepin-cli/captures/search-capture-<ts>.json
 *
 * 输出:
 *   1. 全部去重 URL + 方法 + 状态码
 *   2. 搜索相关 URL 的完整 request body / response body
 *   3. buildSearchBody() 在不同参数下的输出, 方便和真实 payload 对比
 */

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { buildSearchBody } from '../dist/toolset/search.js';

if (argv.length < 3) {
  console.error('用法: node scripts/analyze-capture.mjs <capture.json>');
  exit(1);
}

const captureFile = argv[2];
let data;
try {
  data = JSON.parse(readFileSync(captureFile, 'utf8'));
} catch (e) {
  console.error(`读文件失败: ${e.message}`);
  exit(1);
}

const all = data.all || data.searchRelatedCalls || [];
console.log(`\n=== 抓包摘要 ===`);
console.log(`  文件:        ${captureFile}`);
console.log(`  抓取时间:    ${data.capturedAt || '?'}`);
console.log(`  总请求数:    ${data.totalRequests ?? all.length}`);
console.log(`  搜索相关:    ${data.searchRelated ?? '?'}`);

// 1. 按 URL 模板分组 (去掉 query string 和数字 ID)
const groups = new Map();
for (const c of all) {
  const tpl = c.url
    .replace(/\?.*$/, '')
    .replace(/\/\d+(\/|$)/g, '/:id$1')
    .replace(/[a-f0-9]{20,}/gi, ':hash');
  if (!groups.has(tpl)) {
    groups.set(tpl, { count: 0, methods: new Set(), statuses: new Set(), sample: c });
  }
  const g = groups.get(tpl);
  g.count++;
  g.methods.add(c.method);
  g.statuses.add(c.responseStatus);
}

console.log(`\n=== 去重 URL 模板 (按请求数排序) ===`);
const sortedGroups = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [tpl, g] of sortedGroups.slice(0, 30)) {
  const isSearch = /search|jobcard|pc-search|recommend|talent|chat/i.test(tpl);
  const flag = isSearch ? '🔍' : '  ';
  console.log(`${flag} [${String(g.count).padStart(3)}] ${[...g.methods].join(',').padEnd(6)} ${[...g.statuses].join(',')}  ${tpl}`);
}

// 2. 搜索相关的完整内容
const searchRelated = all.filter(c => /search|jobcard|pc-search/i.test(c.url) || (c.postData && /search|job/i.test(c.postData)));
console.log(`\n=== 搜索相关请求 (${searchRelated.length} 个) ===\n`);

searchRelated.forEach((c, i) => {
  console.log(`\n--- [${i + 1}/${searchRelated.length}] ${c.method} ${c.url} ---`);
  console.log(`  状态: ${c.responseStatus}`);
  if (c.postData) {
    console.log(`  请求体 (raw): ${c.postData.slice(0, 2000)}`);
  }
  if (c.responseBody && c.responseBody.length < 5000) {
    console.log(`  响应体: ${c.responseBody}`);
  } else if (c.responseBody) {
    console.log(`  响应体 (前 2000 字符): ${c.responseBody.slice(0, 2000)}...`);
  }
});

// 3. buildSearchBody 输出, 方便对比
console.log(`\n\n=== buildSearchBody() 当前实现 (search.ts:42-75) ===`);
const samples = [
  { name: 'init / 第 1 页 / 默认', params: { city: '410', key: '前端工程师', currentPage: 0, pageSize: 40, scene: 'init' } },
  { name: 'search / 第 2 页', params: { city: '410', key: '前端工程师', currentPage: 1, pageSize: 40, workYearCode: '5_10', scene: 'search' } },
];
for (const s of samples) {
  console.log(`\n--- ${s.name} ---`);
  console.log(JSON.stringify(buildSearchBody(s.params), null, 2));
}

console.log(`\n=== 验证关键字段 ===`);
console.log(`  - 当前代码 client_id:    40108 (search.ts:120)`);
console.log(`  - 备选 client_id:        40156 (lpt-utils.ts)`);
console.log(`  - 当前代码 endpoint:     ${`${'(LIEPIN_API)'}/api/com.liepin.searchfront4c.pc-search-job`} (search.ts:182)`);
console.log(`  - 备选 endpoint host:    LIEPIN_LPT_API`);
console.log(`\n请对比上面抓到的真实 payload 跟 buildSearchBody 输出.`);
