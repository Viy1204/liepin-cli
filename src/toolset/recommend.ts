/**
 * 猎聘推荐候选人命令
 */

import { Page } from 'puppeteer-core';
import { RECOMMEND_COLUMNS } from '../common/utils.js';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt } from '../common/lpt-utils.js';

export interface RecommendOptions {
  jobTitle?: string;
  jobId?: string;
  page?: number;
  limit?: number;
}

function buildRecommendBody(ejobId: number | string, limit: number, operateKind: string = 'LOGIN'): string {
  const form = new URLSearchParams();
  form.set('lpRecommendQueryInputVo', JSON.stringify({
    pageSize: Math.min(Number(limit) || 20, 40),
    ejobId: Number(ejobId) || 0,
    siftConditionVo: {
      requireWorkYear: ['0'],
      requireDegree: ['000'],
      minSalary: 0,
      maxSalary: 0,
      schoolTag: ['0'],
      pcMinAge: '',
      pcMaxAge: '',
      graduateCodes: [],
      seekWill: ['000'],
      studentUsercHopeKinds: [],
      sex: '000',
      industries: ['000'],
      jobFrequency: '000',
    },
    queryKind: '5',
    operateKind,
  }));
  return form.toString();
}

function mapRecommendCandidate(item: any) {
  const resume = item.resume || {};
  const latestWork = resume.workExpList?.[0] || {};
  const want = resume.jobWant || {};

  return {
    name: resume.showName || '',
    title: want.wantTitle || latestWork.rwdsTitle || '',
    company: latestWork.rwdCompname || '',
    salary: want.wantSalary || '',
    experience: resume.workYearsShow || '',
    education: resume.eduLevelShow || '',
    city: want.wantDqName || resume.cityName || '',
    active_status: resume.activeStatus || '',
    talentId: resume.enresId || '',
    user_id: resume.enusercId || '',
    im_id: resume.imId || '',
    url: resume.url || '',
    job_id: String(item.job?.jobId || ''),
    job_title: item.job?.jobTitle || '',
  };
}

export async function recommend(page: Page, options: RecommendOptions): Promise<any[]> {
  const { jobId = '', limit = 20 } = options;

  // 导航到推荐页面
  await navigateToLpt(page, '/recommend', 2);

  const initBody = new URLSearchParams({
    ejobId: jobId || '0',
  });
  const init = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.recruitbff.lpt.recommend.init`, {
    body: initBody.toString(),
  });

  if (init.flag !== 1) {
    throw new Error(`获取推荐初始化失败: ${JSON.stringify(init).slice(0, 200)}`);
  }

  const ejobId = jobId || init.data?.ejobId || init.data?.jobs?.[0]?.jobId;
  if (!ejobId) {
    throw new Error('获取推荐候选人失败：没有可用职位，请先在猎聘招聘者端发布或选择职位');
  }

  const response = await lptFetch(
    page,
    `${LIEPIN_LPT_API}/api/com.liepin.recruitbff.lpt.recommend.get-recommend-resumes`,
    { body: buildRecommendBody(ejobId, limit) },
  );

  // 处理响应
  if (response.flag !== 1 || !Array.isArray(response.data?.list)) {
    throw new Error('获取推荐候选人失败：' + (response?.message || response?.msg || '未知错误'));
  }

  // 映射结果
  return response.data.list.slice(0, Number(limit) || 20).map(mapRecommendCandidate);
}

/** 推荐候选人命令定义 */
export const recommendCommand = {
  name: 'recommend',
  description: '查看推荐候选人',
  args: [
    { name: 'jobTitle', type: 'string', default: '', help: '职位名称（筛选条件）' },
    { name: 'jobId', type: 'string', default: '', help: '猎聘职位 ID（默认使用推荐页当前职位）' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: RECOMMEND_COLUMNS,
  func: recommend,
};
