/**
 * 猎聘职位详情命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_DOMAIN,
  JOB_DETAIL_COLUMNS,
  navigateTo, sleepRandom,
} from '../common/utils.js';

export interface DetailOptions {
  jobId: string;
}

export async function detail(page: Page, options: DetailOptions): Promise<any> {
  const { jobId } = options;

  if (!jobId) {
    throw new Error('职位 ID 不能为空');
  }

  // 导航到职位详情页
  await navigateTo(page, `https://${LIEPIN_DOMAIN}/job/${jobId}.html`);

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 提取职位详情
  const jobDetail = await page.evaluate(() => {
    const title = document.querySelector('.job-title')?.textContent?.trim() || '';
    const company = document.querySelector('.company-name')?.textContent?.trim() || '';
    const salary = document.querySelector('.job-salary')?.textContent?.trim() || '';
    const city = document.querySelector('.job-area')?.textContent?.trim() || '';
    const experience = document.querySelector('.job-require')?.textContent?.trim() || '';
    const education = document.querySelector('.job-require')?.textContent?.trim() || '';
    const description = document.querySelector('.job-description')?.textContent?.trim() || '';
    const requirements = document.querySelector('.job-requirements')?.textContent?.trim() || '';
    const benefits = document.querySelector('.job-benefits')?.textContent?.trim() || '';
    const publishTime = document.querySelector('.publish-time')?.textContent?.trim() || '';

    return {
      title,
      company,
      salary,
      city,
      experience,
      education,
      description,
      requirements,
      benefits,
      publishTime,
    };
  });

  return jobDetail;
}

/** 职位详情命令定义 */
export const detailCommand = {
  name: 'detail',
  description: '查看职位详情',
  args: [
    { name: 'jobId', type: 'string', required: true, positional: true, help: '职位 ID' },
  ],
  columns: JOB_DETAIL_COLUMNS,
  func: detail,
};
