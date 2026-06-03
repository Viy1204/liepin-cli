/**
 * 猎聘人才搜索命令 - 招聘者端
 */

import { Page } from 'puppeteer-core';
import {
  WORKYEAR_CODES, DEGREE_CODES, INDUSTRY_CODES,
  resolveCity, resolveCode, resolveSalary,
} from '../common/utils.js';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt } from '../common/lpt-utils.js';

export interface SearchOptions {
  query: string;
  city?: string;
  experience?: string;
  salary?: string;
  degree?: string;
  industry?: string;
  page?: number;
  limit?: number;
}

function resolveWorkYears(value: string): string {
  if (!value || value === '不限') return '0,99';
  const code = resolveCode(value, WORKYEAR_CODES);
  if (!code) return '0,99';
  return code.replace('$', ',');
}

function resolveEduLevels(value: string): string[] {
  const code = resolveCode(value, DEGREE_CODES);
  return code ? [code] : [];
}

function resolveAnnualSalary(value: string): { low: string; high: string } {
  const salary = resolveSalary(value);
  if (!salary.low && !salary.high) return { low: '', high: '' };

  return {
    low: salary.low ? String(Number(salary.low) * 12) : '',
    high: salary.high ? String(Number(salary.high) * 12) : '',
  };
}

/** 构建招聘者端人才搜索请求体 */
export function buildSearchBody(params: {
  city?: string;
  key?: string;
  currentPage?: number;
  workYearCode?: string;
  eduLevel?: string;
  industry?: string;
  salaryLow?: string;
  salaryHigh?: string;
}) {
  const ckId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const cvSearchConditionInputVo = {
    suggestKey: '',
    searchRefer: '1',
    cvSearchForm: 0,
    searchKey: '',
    filterKey: '',
    degrade: '',
    csCreateTimeFlag: '',
    csCreateTime: '',
    csId: '',
    curPage: params.currentPage ?? 0,
    keys: params.key || '',
    showKeys: '',
    searchLevel: '',
    dqs: params.city || '',
    wantDqs: '',
    workyears: params.workYearCode || '0,99',
    eduLevels: params.eduLevel ? [params.eduLevel] : [],
    industrys: params.industry || '',
    jobtitles: '',
    wantIndustrys: '',
    wantJobTitles: '',
    activeStatus: '',
    userStatus: '',
    yearSalarylow: '',
    yearSalaryhigh: '',
    wantYearSalaryLow: params.salaryLow || '',
    wantYearSalaryHigh: params.salaryHigh || '',
    sex: '',
    age: '',
    special: '',
    sortflag: '',
    abroadEdu: '',
    abroadExp: '',
    manageExp: '',
    language_skills: '',
    language_content: '',
    filterRead: '',
    filterChat: '',
    filterDownload: '',
    lastWork: '',
    titleKeys: '',
    titleSearchFilter: '0',
    companyKeys: '',
    compSearchFilter: '0',
    interactiveVersion: 'v2',
    jobId: '',
    pubJobTitle: '',
    schoolKindList: [],
    graduationYearList: [],
    eduLevelTzCode: '',
    resLanguage: '',
    pushId: '',
    jobStability: '',
    school: '',
    smartReadToken: '',
    taskId: '',
    searchBatchId: '',
    aimultikeyId: '',
    keysRelation: '',
  };

  const form = new URLSearchParams();
  form.set('cvSearchConditionInputVo', JSON.stringify(cvSearchConditionInputVo));
  form.set('logForm', JSON.stringify({
    skId: '',
    fkId: '',
    ckId,
    searchScene: 'button',
  }));
  return form.toString();
}

/** 映射候选人卡片 */
export function mapJobCard(item: any, rank: number) {
  const latestWork = item.workExpList?.[0] || {};
  const latestEdu = item.eduExpList?.[0] || {};
  return {
    rank,
    name: item.resName || '',
    title: item.wantJobTitle || latestWork.title || '',
    salary: item.wantSalary || '',
    city: item.wantDq || item.resDqName || '',
    experience: item.workYearsShow || '',
    degree: item.resEdulevelName || latestEdu.eduDegreeName || '',
    company: latestWork.compName || '',
    current_title: latestWork.title || '',
    school: latestEdu.schoolName || '',
    age: item.ageShow || '',
    active_status: item.activeStatus?.name || item.offLineOrRefreshTime || '',
    resume_id: String(item.resIdEncode || ''),
    user_id: String(item.usercId || ''),
    im_id: String(item.imId || ''),
    url: item.resumeUrl || '',
  };
}

export async function search(page: Page, options: SearchOptions): Promise<any[]> {
  const {
    query,
    city = '全国',
    experience = '',
    salary = '',
    degree = '',
    industry = '',
    page: pageNum = 1,
    limit = 20,
  } = options;

  // 解析参数
  const cityCode = city === '全国' ? '' : resolveCity(city);
  const workYearCode = resolveWorkYears(experience);
  const eduLevel = resolveEduLevels(degree)[0] || '';
  const industryCode = resolveCode(industry, INDUSTRY_CODES);
  const salaryRange = resolveAnnualSalary(salary);

  // 确保在猎聘招聘者页面上
  const currentUrl = await page.evaluate(() => window.location.href);
  if (!String(currentUrl).includes('lpt.liepin.com/search')) {
    console.log('正在跳转到招聘者端搜索人才...');
    await navigateToLpt(page, '/search', 2);
  }

  const apiUrl = `${LIEPIN_LPT_API}/api/com.liepin.searchfront4r.b.search`;
  const allJobs: any[] = [];
  const seenIds = new Set<string>();
  let currentPage = pageNum;

  while (allJobs.length < limit) {
    const body = buildSearchBody({
      city: cityCode,
      key: query,
      currentPage: (currentPage - 1),
      workYearCode,
      eduLevel,
      industry: industryCode,
      salaryLow: salaryRange.low,
      salaryHigh: salaryRange.high,
    });

    const data = await lptFetch(page, apiUrl, { body });

    // 检查响应
    if (data.flag !== 1) {
      const msg = data.msg || data.message || JSON.stringify(data).slice(0, 200);
      throw new Error(`搜索失败: ${msg}`);
    }

    const jobList = data.data?.cvSearchResultForm?.cvSearchListFormList || [];
    if (jobList.length === 0) break;

    for (const item of jobList) {
      const jobId = String(item.resIdEncode || '');
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
  { header: '候选人', key: 'name', width: 10 },
  { header: '期望职位', key: 'title', width: 24 },
  { header: '薪资', key: 'salary', width: 15 },
  { header: '城市', key: 'city', width: 10 },
  { header: '经验', key: 'experience', width: 10 },
  { header: '学历', key: 'degree', width: 10 },
  { header: '当前公司', key: 'company', width: 18 },
  { header: '当前职位', key: 'current_title', width: 18 },
  { header: '简历ID', key: 'resume_id', width: 18 },
];

/** 搜索命令定义 */
export const searchCommand = {
  name: 'search',
  description: '搜索人才（招聘者端）',
  args: [
    { name: 'query', type: 'string', required: true, positional: true, help: '搜索关键词（岗位名 / 技能 / 公司）' },
    { name: 'city', type: 'string', default: '全国', help: '城市名或代码（如 "北京" / "杭州" / "410"）' },
    { name: 'experience', type: 'string', default: '', help: '工作经验：应届/1-3年/3-5年/5-10年/10年以上' },
    { name: 'salary', type: 'string', default: '', help: '月薪范围：3K以下/3-5K/5-10K/10-15K/15-20K/20-30K/30-50K/50K以上' },
    { name: 'degree', type: 'string', default: '', help: '学历：大专/本科/硕士/博士' },
    { name: 'industry', type: 'string', default: '', help: '行业（如 "互联网" / "金融"）' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: SEARCH_COLUMNS,
  func: search,
};
