/**
 * 猎聘推荐候选人命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_API,
  RECOMMEND_COLUMNS,
  navigateTo, liepinFetch, sleepRandom,
} from '../common/utils.js';

export interface RecommendOptions {
  jobTitle?: string;
  page?: number;
  limit?: number;
}

export async function recommend(page: Page, options: RecommendOptions): Promise<any[]> {
  const { jobTitle = '', page: pageNum = 1, limit = 20 } = options;

  // 导航到推荐页面
  await navigateTo(page, 'https://www.liepin.com/recommend');

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 获取推荐候选人
  const response = await liepinFetch(page, `${LIEPIN_API}/api/com.liepin.recruitment.pc-recommend-candidates`, {
    method: 'POST',
    body: JSON.stringify({
      jobTitle,
      currentPage: pageNum,
      pageSize: Math.min(limit, 40),
    }),
  });

  // 处理响应
  if (!response || !response.data || !response.data.list) {
    throw new Error('获取推荐候选人失败：' + (response?.message || '未知错误'));
  }

  // 映射结果
  return response.data.list.map((item: any) => ({
    name: item.name || '',
    title: item.title || '',
    company: item.company || '',
    salary: item.salary || '',
    experience: item.experience || '',
    education: item.education || '',
    talentId: item.talentId || '',
  }));
}

/** 推荐候选人命令定义 */
export const recommendCommand = {
  name: 'recommend',
  description: '查看推荐候选人',
  args: [
    { name: 'jobTitle', type: 'string', default: '', help: '职位名称（筛选条件）' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: RECOMMEND_COLUMNS,
  func: recommend,
};
