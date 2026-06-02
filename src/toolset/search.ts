/**
 * 猎聘职位搜索命令 - 招聘者端
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_API,
  CITY_CODES, WORKYEAR_CODES, DEGREE_CODES, INDUSTRY_CODES,
  COMPSIZE_CODES, JOBKIND_CODES,
  resolveCity, resolveCode, resolveSalary,
  sleep, sleepRandom,
} from '../common/utils.js';

export interface SearchOptions {
  query: string;
  city?: string;
  experience?: string;
  salary?: string;
  degree?: string;
  industry?: string;
  compScale?: string;
  jobKind?: string;
  page?: number;
  limit?: number;
}

/** 构建搜索请求体 */
function buildSearchBody(params: {
  city?: string;
  key?: string;
  currentPage?: number;
  pageSize?: number;
  workYearCode?: string;
  eduLevel?: string;
  industry?: string;
  compScale?: string;
  jobKind?: string;
  salaryLow?: string;
  salaryHigh?: string;
  scene?: string;
}) {
  return {
    data: {
      mainSearchPcConditionForm: {
        city: params.city || '410',
        dq: params.city || '410',
        pubTime: '',
        currentPage: String(params.currentPage ?? 0),
        pageSize: String(params.pageSize ?? 40),
        key: params.key || '',
        suggestTag: '',
        workYearCode: params.workYearCode || '',
        compId: '',
        compName: '',
        compTag: '',
        industry: params.industry || '',
        salaryCode: '',
        jobKind: params.jobKind || '',
        compScale: params.compScale || '',
        compKind: '',
        compStage: '',
        eduLevel: params.eduLevel || '',
        salaryLow: params.salaryLow || '',
        salaryHigh: params.salaryHigh || '',
      },
      passThroughForm: {
        scene: 'search',
        skId: '',
        fkId: '',
        ckId: '',
        suggest: null,
      },
    },
  };
}

/** 映射职位卡片 */
function mapJobCard(item: any, rank: number) {
  const job = item.job || {};
  const comp = item.comp || {};
  const recruiter = item.recruiter || {};
  return {
    rank,
    title: job.title || '',
    salary: job.salary || '',
    city: (job.dq || '').split('-')[0] || '',
    district: (job.dq || '').split('-')[1] || '',
    experience: job.requireWorkYears || '',
    degree: job.requireEduLevel || '',
    company: comp.compName || '',
    company_size: comp.compScale || '',
    company_industry: comp.compIndustry || '',
    hr: recruiter.recruiterName
      ? `${recruiter.recruiterName}·${recruiter.recruiterTitle || ''}`
      : '',
    job_id: String(job.jobId || ''),
    url: job.link || '',
  };
}

/** 猎聘 API 请求 */
async function liepinFetch(page: Page, url: string, opts: { body: any }): Promise<any> {
  const bodyStr = JSON.stringify(opts.body);
  
  const result = await page.evaluate(async (fetchUrl: string, fetchBody: string) => {
    try {
      const xsrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('XSRF-TOKEN='));
      const token = xsrf ? xsrf.split('=').slice(1).join('') : '';
      
      const resp = await fetch(fetchUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json;charset=UTF-8',
          'x-client-type': 'web',
          'x-requested-with': 'XMLHttpRequest',
          'x-xsrf-token': token,
          'x-fscp-version': '1.1',
          'x-fscp-std-info': '{"client_id": "40108"}',
        },
        body: fetchBody,
      });
      
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text };
    } catch (e: any) {
      return { ok: false, status: 0, text: '', error: String(e?.message || e) };
    }
  }, url, bodyStr);
  
  const res = result as any;
  
  if (res.error) {
    throw new Error(`请求失败: ${res.error}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP 错误: ${res.status}`);
  }
  if (res.text.trim().startsWith('<')) {
    throw new Error('返回了 HTML（可能是反爬虫挑战），请重新登录');
  }
  
  try {
    return JSON.parse(res.text);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${res.text.slice(0, 200)}`);
  }
}

export async function search(page: Page, options: SearchOptions): Promise<any[]> {
  const {
    query,
    city = '全国',
    experience = '',
    salary = '',
    degree = '',
    industry = '',
    compScale = '',
    jobKind = '',
    page: pageNum = 1,
    limit = 20,
  } = options;

  // 解析参数
  const cityCode = resolveCity(city);
  const workYearCode = resolveCode(experience, WORKYEAR_CODES);
  const eduLevel = resolveCode(degree, DEGREE_CODES);
  const industryCode = resolveCode(industry, INDUSTRY_CODES);
  const compScaleCode = resolveCode(compScale, COMPSIZE_CODES);
  const jobKindCode = resolveCode(jobKind, JOBKIND_CODES);
  const salaryRange = resolveSalary(salary);

  // 确保在猎聘招聘者页面上
  const currentUrl = await page.evaluate(() => window.location.href);
  if (!String(currentUrl).includes('lpt.liepin.com')) {
    console.log('正在跳转到招聘者端...');
    await page.goto('https://lpt.liepin.com/recommend', { waitUntil: 'networkidle2' });
    await sleep(2000);
  }

  const apiUrl = `${LIEPIN_API}/api/com.liepin.searchfront4c.pc-search-job`;
  const allJobs: any[] = [];
  const seenIds = new Set<string>();
  let currentPage = pageNum;
  const pageSize = Math.min(limit, 40);

  while (allJobs.length < limit) {
    if (allJobs.length > 0) {
      await sleepRandom(1000, 2000);
    }

    const body = buildSearchBody({
      city: cityCode,
      key: query,
      currentPage: (currentPage - 1),
      pageSize,
      workYearCode,
      eduLevel,
      industry: industryCode,
      compScale: compScaleCode,
      jobKind: jobKindCode,
      salaryLow: salaryRange.low,
      salaryHigh: salaryRange.high,
      scene: currentPage === 1 ? 'init' : 'search',
    });

    const data = await liepinFetch(page, apiUrl, { body });

    // 检查响应
    if (data.flag !== 1) {
      const msg = data.msg || data.message || JSON.stringify(data).slice(0, 200);
      throw new Error(`搜索失败: ${msg}`);
    }

    const jobList = data.data?.data?.jobCardList || [];
    if (jobList.length === 0) break;

    for (const item of jobList) {
      const jobId = String(item.job?.jobId || '');
      if (jobId && !seenIds.has(jobId)) {
        seenIds.add(jobId);
        allJobs.push(mapJobCard(item, allJobs.length + 1));
        if (allJobs.length >= limit) break;
      }
    }

    currentPage++;
    
    // 防止无限循环
    if (currentPage > pageNum + 10) break;
  }

  return allJobs;
}

/** 搜索结果列定义 */
export const SEARCH_COLUMNS = [
  { header: '#', key: 'rank', width: 4 },
  { header: '职位', key: 'title', width: 30 },
  { header: '薪资', key: 'salary', width: 15 },
  { header: '城市', key: 'city', width: 10 },
  { header: '经验', key: 'experience', width: 10 },
  { header: '学历', key: 'degree', width: 10 },
  { header: '公司', key: 'company', width: 20 },
  { header: 'HR', key: 'hr', width: 15 },
  { header: 'ID', key: 'job_id', width: 15 },
];

/** 搜索命令定义 */
export const searchCommand = {
  name: 'search',
  description: '猎聘搜索职位',
  args: [
    { name: 'query', type: 'string', required: true, positional: true, help: '搜索关键词（岗位名 / 技能 / 公司）' },
    { name: 'city', type: 'string', default: '全国', help: '城市名或代码（如 "北京" / "杭州" / "410"）' },
    { name: 'experience', type: 'string', default: '', help: '工作经验：应届/1-3年/3-5年/5-10年/10年以上' },
    { name: 'salary', type: 'string', default: '', help: '月薪范围：3K以下/3-5K/5-10K/10-15K/15-20K/20-30K/30-50K/50K以上' },
    { name: 'degree', type: 'string', default: '', help: '学历：大专/本科/硕士/博士' },
    { name: 'industry', type: 'string', default: '', help: '行业（如 "互联网" / "金融"）' },
    { name: 'compScale', type: 'string', default: '', help: '公司规模（如 "100-499人" / "10000人以上"）' },
    { name: 'jobKind', type: 'string', default: '', help: '职位类型：猎头/企业' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: SEARCH_COLUMNS,
  func: search,
};
