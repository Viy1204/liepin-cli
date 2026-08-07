/**
 * 打开猎聘招聘者端浏览器（有头模式）
 * 用户可以手动操作，关闭浏览器窗口即退出
 */

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

// 加载配置
const configPath = join(homedir(), '.liepin-cli', 'config.json');
let fileConfig = {};
if (existsSync(configPath)) {
  try {
    fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {}
}

// 检测 Chrome/Edge 路径
function detectBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find(p => existsSync(p)) || '';
}

const chromePath = process.env.CHROME_PATH || detectBrowserPath();
if (!chromePath) {
  console.error('未检测到 Chrome/Edge，请设置 CHROME_PATH 环境变量');
  process.exit(1);
}

const userDataDir = join(homedir(), '.liepin-cli', 'user-data');

console.log('正在启动浏览器...');
console.log(`Chrome: ${chromePath}`);
console.log(`用户数据: ${userDataDir}`);
console.log('');

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false,
  userDataDir,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--start-maximized',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

// 导航到职位管理页面
console.log('正在打开猎聘招聘者端职位管理页面...');
await page.goto('https://lpt.liepin.com/job/manager', { waitUntil: 'networkidle2' });

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  浏览器已打开，可以手动操作');
console.log('  点击"发布新职位"按钮添加岗位');
console.log('  关闭浏览器窗口即退出程序');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// 等待浏览器关闭
await new Promise((resolve) => {
  browser.on('disconnected', resolve);
});
