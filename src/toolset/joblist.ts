/**
 * 猎聘职位列表命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_API,
  SEARCH_COLUMNS,
  navigateTo, liepinFetch, sleepRandom,
} from '../common/utils.js';

export interface JoblistOptions {
  status?: string;
  page?: number;
  limit?: number;
}

export async function joblist(page: Page, options: JoblistOptions): Promise<any[]> {
  const { status = '', page: pageNum = 1, limit = 20 } = options;

  // 导航到职位管理页面
  await navigateTo(page, 'https://www.liepin.com/job/manage');

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 获取职位列表
  const response = await liepinFetch(page, `${LIEPIN_API}/api/com.liepin.recruitment.pc-job-list`, {
    method: 'POST',
    body: JSON.stringify({
      status,
      currentPage: pageNum,
      pageSize: Math.min(limit, 40),
    }),
  });

  // 处理响应
  if (!response || !response.data || !response.data.list) {
    throw new Error('获取职位列表失败：' + (response?.message || '未知错误'));
  }

  // 映射结果
  return response.data.list.map((item: any) => ({
    title: item.title || '',
    company: item.company || '',
    salary: item.salary || '',
    city: item.city || '',
    experience: item.experience || '',
    education: item.education || '',
    status: item.status || '',
    jobId: item.jobId || '',
    publishTime: item.publishTime || '',
  }));
}

/** 职位列表命令定义 */
export const joblistCommand = {
  name: 'joblist',
  description: '查看职位列表',
  args: [
    { name: 'status', type: 'string', default: '', help: '职位状态：在线/下线/审核中' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: [
    { header: '职位', key: 'title', width: 30 },
    { header: '公司', key: 'company', width: 20 },
    { header: '薪资', key: 'salary', width: 15 },
    { header: '城市', key: 'city', width: 10 },
    { header: '状态', key: 'status', width: 10 },
    { header: '发布时间', key: 'publishTime', width: 15 },
  ],
  func: joblist,
};
