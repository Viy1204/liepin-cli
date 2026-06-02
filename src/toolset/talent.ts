/**
 * 猎聘人才列表命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_API,
  TALENT_COLUMNS,
  navigateTo, liepinFetch, sleepRandom,
} from '../common/utils.js';

export interface TalentOptions {
  query?: string;
  city?: string;
  experience?: string;
  salary?: string;
  degree?: string;
  page?: number;
  limit?: number;
}

export async function talent(page: Page, options: TalentOptions): Promise<any[]> {
  const {
    query = '',
    city = '',
    experience = '',
    salary = '',
    degree = '',
    page: pageNum = 1,
    limit = 20,
  } = options;

  // 导航到人才库页面
  await navigateTo(page, 'https://www.liepin.com/talent');

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 获取人才列表
  const response = await liepinFetch(page, `${LIEPIN_API}/api/com.liepin.recruitment.pc-talent-list`, {
    method: 'POST',
    body: JSON.stringify({
      keyWord: query,
      dq: city,
      workYearCode: experience,
      salary,
      eduLevel: degree,
      currentPage: pageNum,
      pageSize: Math.min(limit, 40),
    }),
  });

  // 处理响应
  if (!response || !response.data || !response.data.list) {
    throw new Error('获取人才列表失败：' + (response?.message || '未知错误'));
  }

  // 映射结果
  return response.data.list.map((item: any) => ({
    name: item.name || '',
    title: item.title || '',
    company: item.company || '',
    salary: item.salary || '',
    experience: item.experience || '',
    education: item.education || '',
    status: item.status || '',
    talentId: item.talentId || '',
  }));
}

/** 人才列表命令定义 */
export const talentCommand = {
  name: 'talent',
  description: '查看人才库',
  args: [
    { name: 'query', type: 'string', default: '', help: '搜索关键词' },
    { name: 'city', type: 'string', default: '', help: '城市' },
    { name: 'experience', type: 'string', default: '', help: '工作经验' },
    { name: 'salary', type: 'string', default: '', help: '薪资范围' },
    { name: 'degree', type: 'string', default: '', help: '学历' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: TALENT_COLUMNS,
  func: talent,
};
