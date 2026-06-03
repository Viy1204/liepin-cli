/**
 * 猎聘 CLI 配置管理
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveChromePath(): string {
  if (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '';
  }

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];

  return candidates.find(path => existsSync(path)) || '';
}

/** 默认配置 */
export const DEFAULT_CONFIG = {
  /** Chrome/Edge 可执行文件路径 */
  chromePath: resolveChromePath(),
  
  /** 用户数据目录 */
  userDataDir: process.env.LIEPIN_USER_DATA_DIR || join(process.env.HOME || '', '.liepin-cli', 'user-data'),
  
  /** 截图目录 */
  screenshotDir: process.env.LIEPIN_SCREENSHOT_DIR || join(process.env.HOME || '', '.liepin-cli', 'screenshots'),
  
  /** 配置文件路径 */
  configDir: process.env.LIEPIN_CONFIG_DIR || join(process.env.HOME || '', '.liepin-cli'),
  
  /** 浏览器视口 */
  viewport: {
    width: 1280,
    height: 800,
  },
  
  /** 是否无头模式 */
  headless: process.env.LIEPIN_HEADLESS === 'true',
  
  /** 是否使用代理 */
  proxy: process.env.LIEPIN_PROXY || '',
  
  /** 调试模式 */
  debug: process.env.LIEPIN_DEBUG === 'true',
};

/** 加载配置文件 */
function loadConfigFile(): Record<string, any> {
  const configPath = join(DEFAULT_CONFIG.configDir, 'config.json');
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

/** 合并配置 */
export function getConfig() {
  const fileConfig = loadConfigFile();
  return { ...DEFAULT_CONFIG, ...fileConfig };
}

/** 配置实例 */
export const config = getConfig();
