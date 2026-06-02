/**
 * 猎聘登录命令 - 招聘者端
 */

import { Page } from 'puppeteer-core';
import { sleep } from '../common/utils.js';

export interface LoginOptions {
  timeout?: number;
}

export async function login(page: Page, options: LoginOptions): Promise<any> {
  const { timeout = 120 } = options;

  // 导航到猎聘招聘者端登录页
  console.log('正在打开猎聘招聘者端...');
  await page.goto('https://lpt.liepin.com/', { waitUntil: 'networkidle2' });
  await sleep(2000);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  请在浏览器中完成登录（扫码或账号密码）');
  console.log('  这是招聘者端 (lpt.liepin.com)');
  console.log('  登录成功后会自动检测');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // 等待用户登录完成
  const startTime = Date.now();
  const timeoutMs = timeout * 1000;
  let lastCheck = 0;

  while (Date.now() - startTime < timeoutMs) {
    const now = Date.now();
    if (now - lastCheck < 2000) {
      await sleep(500);
      continue;
    }
    lastCheck = now;

    const status = await page.evaluate(() => {
      const url = window.location.href;
      
      // 检查是否在登录页
      const isOnLogin = url.includes('/login') || url.includes('/signin') || url.includes('/passport');
      
      // 检查是否有用户信息
      const hasUser = !!(
        document.querySelector('.user-info') ||
        document.querySelector('.user-name') ||
        document.querySelector('[class*="avatar"]') ||
        document.querySelector('[class*="userName"]') ||
        document.querySelector('.recruiter-name') ||
        // 检查是否有退出按钮
        document.querySelector('a[href*="logout"]') ||
        document.querySelector('button[class*="logout"]')
      );

      // 检查页面标题或内容
      const pageTitle = document.title || '';
      const hasRecruiterContent = pageTitle.includes('招聘') || 
        !!document.querySelector('[class*="recruiter"]') ||
        !!document.querySelector('[class*="hr-"]');

      return { url, isOnLogin, hasUser, hasRecruiterContent };
    }).catch(() => ({ url: '', isOnLogin: true, hasUser: false, hasRecruiterContent: false }));

    // 检测到登录成功
    if (!status.isOnLogin && (status.hasUser || status.hasRecruiterContent)) {
      console.log('');
      console.log('✅ 登录成功！');
      console.log('   已登录猎聘招聘者端');
      console.log('   Cookie 已保存到用户数据目录');
      console.log('');
      
      return {
        success: true,
        message: '登录成功',
      };
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  等待登录中... ${elapsed}s / ${timeout}s`);
  }

  console.log('');
  console.log('❌ 登录超时，请重试');
  
  return {
    success: false,
    message: '登录超时',
  };
}

/** 登录命令定义 */
export const loginCommand = {
  name: 'login',
  description: '登录猎聘招聘者端',
  args: [
    { name: 'timeout', type: 'int', default: 120, help: '登录超时时间（秒）' },
  ],
  columns: [
    { header: '结果', key: 'result', width: 80 },
  ],
  func: login,
};
