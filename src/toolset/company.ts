/**
 * 猎聘公司信息命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_DOMAIN,
  COMPANY_COLUMNS,
  navigateTo, sleepRandom,
} from '../common/utils.js';

export interface CompanyOptions {
  companyId: string;
}

export async function company(page: Page, options: CompanyOptions): Promise<any> {
  const { companyId } = options;

  if (!companyId) {
    throw new Error('公司 ID 不能为空');
  }

  // 导航到公司详情页
  await navigateTo(page, `https://${LIEPIN_DOMAIN}/company/${companyId}.html`);

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 提取公司信息
  const companyInfo = await page.evaluate(() => {
    const name = document.querySelector('.company-name')?.textContent?.trim() || '';
    const industry = document.querySelector('.company-industry')?.textContent?.trim() || '';
    const scale = document.querySelector('.company-scale')?.textContent?.trim() || '';
    const stage = document.querySelector('.company-stage')?.textContent?.trim() || '';
    const address = document.querySelector('.company-address')?.textContent?.trim() || '';
    const description = document.querySelector('.company-description')?.textContent?.trim() || '';
    const website = document.querySelector('.company-website')?.textContent?.trim() || '';
    const founded = document.querySelector('.company-founded')?.textContent?.trim() || '';

    return {
      name,
      industry,
      scale,
      stage,
      address,
      description,
      website,
      founded,
    };
  });

  return companyInfo;
}

/** 公司信息命令定义 */
export const companyCommand = {
  name: 'company',
  description: '查看公司信息',
  args: [
    { name: 'companyId', type: 'string', required: true, positional: true, help: '公司 ID' },
  ],
  columns: COMPANY_COLUMNS,
  func: company,
};
