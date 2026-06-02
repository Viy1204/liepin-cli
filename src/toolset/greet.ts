/**
 * 猎聘打招呼命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_API,
  navigateTo, liepinFetch, sleepRandom,
} from '../common/utils.js';

export interface GreetOptions {
  talentId: string;
  message?: string;
  jobId?: string;
}

export async function greet(page: Page, options: GreetOptions): Promise<any> {
  const { talentId, message = '', jobId = '' } = options;

  if (!talentId) {
    throw new Error('人才 ID 不能为空');
  }

  // 导航到人才详情页
  await navigateTo(page, `https://www.liepin.com/talent/${talentId}.html`);

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 发送打招呼请求
  const response = await liepinFetch(page, `${LIEPIN_API}/api/com.liepin.recruitment.pc-greet-talent`, {
    method: 'POST',
    body: JSON.stringify({
      talentId,
      message: message || '您好，我对您的简历很感兴趣，希望有机会进一步沟通。',
      jobId,
    }),
  });

  // 处理响应
  if (!response || !response.success) {
    throw new Error('打招呼失败：' + (response?.message || '未知错误'));
  }

  return {
    success: true,
    message: '打招呼成功',
    talentId,
  };
}

/** 打招呼命令定义 */
export const greetCommand = {
  name: 'greet',
  description: '向候选人打招呼',
  args: [
    { name: 'talentId', type: 'string', required: true, positional: true, help: '人才 ID' },
    { name: 'message', type: 'string', default: '', help: '打招呼消息' },
    { name: 'jobId', type: 'string', default: '', help: '关联职位 ID' },
  ],
  columns: [
    { header: '结果', key: 'result', width: 80 },
  ],
  func: greet,
};
