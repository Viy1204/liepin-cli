// 临时探测器：按 url 子串找接口，打印 request body 全文 + response 的字段骨架（值脱敏）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const needle = process.argv[2];
const file = process.argv[3] || join(homedir(), '.liepin-cli', 'captures', 'latest-capture.json');
const d = JSON.parse(readFileSync(file, 'utf8'));

function skeleton(v, depth = 0) {
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.length ? [skeleton(v[0], depth + 1), `…(${v.length})`] : [];
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = skeleton(v[k], depth + 1);
    return o;
  }
  if (typeof v === 'string') return v.length > 24 ? `<str:${v.length}>` : v;
  return typeof v;
}

const hits = d.all.filter(c => c.url.includes(needle));
for (const c of hits) {
  console.log('\n========================================================');
  console.log(c.method, c.responseStatus, c.url);
  if (c.postData) console.log('--- REQUEST BODY ---\n' + decodeURIComponent(c.postData).slice(0, 1500));
  try {
    const body = JSON.parse(c.responseBody);
    console.log('--- RESPONSE SKELETON ---\n' + JSON.stringify(skeleton(body), null, 2).slice(0, 2500));
  } catch {
    console.log('--- RESPONSE (raw, 非JSON) ---\n' + (c.responseBody || '').slice(0, 300));
  }
}
if (!hits.length) console.log('没找到含', needle, '的请求');
