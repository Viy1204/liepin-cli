/**
 * 猎聘简历命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_DOMAIN,
  navigateTo, sleepRandom,
} from '../common/utils.js';

export interface ResumeOptions {
  talentId: string;
}

export async function resume(page: Page, options: ResumeOptions): Promise<any> {
  const { talentId } = options;

  if (!talentId) {
    throw new Error('人才 ID 不能为空');
  }

  // 导航到简历详情页
  await navigateTo(page, `https://${LIEPIN_DOMAIN}/talent/${talentId}.html`);

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 提取简历信息
  const resumeInfo = await page.evaluate(() => {
    const name = document.querySelector('.talent-name')?.textContent?.trim() || '';
    const title = document.querySelector('.talent-title')?.textContent?.trim() || '';
    const company = document.querySelector('.talent-company')?.textContent?.trim() || '';
    const salary = document.querySelector('.talent-salary')?.textContent?.trim() || '';
    const experience = document.querySelector('.talent-experience')?.textContent?.trim() || '';
    const education = document.querySelector('.talent-education')?.textContent?.trim() || '';
    const location = document.querySelector('.talent-location')?.textContent?.trim() || '';
    const skills = document.querySelector('.talent-skills')?.textContent?.trim() || '';
    const summary = document.querySelector('.talent-summary')?.textContent?.trim() || '';
    const workHistory = document.querySelector('.talent-work-history')?.textContent?.trim() || '';
    const educationHistory = document.querySelector('.talent-education-history')?.textContent?.trim() || '';

    return {
      name,
      title,
      company,
      salary,
      experience,
      education,
      location,
      skills,
      summary,
      workHistory,
      educationHistory,
    };
  });

  return resumeInfo;
}

/** 简历命令定义 */
export const resumeCommand = {
  name: 'resume',
  description: '查看简历详情',
  args: [
    { name: 'talentId', type: 'string', required: true, positional: true, help: '人才 ID' },
  ],
  columns: [
    { header: '字段', key: 'field', width: 15 },
    { header: '内容', key: 'value', width: 80 },
  ],
  func: resume,
};
