/**
 * 猎聘职位列表命令 - 走 LPT 招聘者端
 *
 * 关键变更 (修复 404):
 *   - 旧: navigateTo(www.liepin.com/job/manage) + liepinFetch(api-c.liepin.com/...pc-job-list)
 *   - 新: navigateToLpt(lpt.liepin.com/job/manager) + lptFetch(api-lpt.liepin.com/...jobmanage.list)
 *   旧 URL 早已 404。LPT 上对应的入口是 /job/manager，BFF 端点是 jobmanage.list。
 */

import { Page } from 'puppeteer-core';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt } from '../common/lpt-utils.js';

export interface JoblistOptions {
  status?: string;
  page?: number;
  limit?: number;
}

/** 状态码 -> 中文名。LPT 返回的 ejobStatusCode 常见值 */
const JOB_STATUS_MAP: Record<string, string> = {
  '10': '审核中',
  '11': '招聘中',
  '12': '已暂停',
  '13': '已关闭',
  '20': '审核未通过',
};

export async function joblist(page: Page, options: JoblistOptions): Promise<any[]> {
  const { status = '', page: pageNum = 1, limit = 20 } = options;

  // 导航到 LPT 职位管理页面
  await navigateToLpt(page, '/job/manager', 2);

  // LPT BFF: /api/com.liepin.recruitbff.lpt.jobmanage.list
  // 真实 body 是 url-encoded form，requestVo 字段是 JSON 字符串
  const requestVo: Record<string, any> = {
    keywordKind: '0',
    keyword: '',
    curPage: Math.max(pageNum - 1, 0),
    pageSize: Math.min(limit, 40),
    jobListType: '0',
    shareFlag: '2',
  };
  const form = new URLSearchParams();
  form.set('requestVo', JSON.stringify(requestVo));

  const data = await lptFetch(
    page,
    `${LIEPIN_LPT_API}/api/com.liepin.recruitbff.lpt.jobmanage.list`,
    { body: form.toString() },
  );

  if (data.flag !== 1) {
    throw new Error(`获取职位列表失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  const jobs = data.data?.ejobList || data.data?.list || [];
  if (!Array.isArray(jobs)) {
    throw new Error('获取职位列表失败: 响应格式异常 (无 ejobList)');
  }

  const mapped = jobs.map((item: any) => {
    const code = String(item.ejobStatusCode || item.ejobStatus || '');
    const newCnt = item.ejobNewApplyCnt;
    const totalCnt = item.ejobTotalApplyCnt;
    const applySummary = (newCnt != null && totalCnt != null)
      ? `${newCnt}/${totalCnt}`
      : '';
    return {
      title: item.ejobTitle || '',
      company: '',  // LPT 端没有返回公司字段（招聘者本人就是公司）
      salary: item.ejobSalaryStr || '',
      city: item.ejobDqName || '',
      experience: item.detailWorkyears || item.workYearName || '',
      education: item.eduLeveName || '',
      status: JOB_STATUS_MAP[code] || (code ? `状态${code}` : ''),
      jobId: String(item.ejobId || ''),
      publishTime: item.showTime || '',
      apply_summary: applySummary,
      new_apply: String(newCnt ?? ''),
      total_apply: String(totalCnt ?? ''),
      connects: String(item.connectNumber ?? ''),
    };
  });

  // status 过滤在客户端做：LPT 列表接口不接受状态入参，按状态中文名筛选返回结果
  return status ? mapped.filter(job => job.status === status) : mapped;
}

/** 职位列表命令定义 */
export const joblistCommand = {
  name: 'joblist',
  description: '查看职位列表',
  args: [
    { name: 'status', type: 'string', default: '', help: '职位状态：招聘中/已暂停/已关闭（不传则全部）' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: [
    { header: '职位', key: 'title', width: 30 },
    { header: '薪资', key: 'salary', width: 15 },
    { header: '城市', key: 'city', width: 12 },
    { header: '状态', key: 'status', width: 10 },
    { header: '刷新时间', key: 'publishTime', width: 15 },
    { header: '新/总投递', key: 'apply_summary', width: 12 },
    { header: '沟通数', key: 'connects', width: 8 },
  ],
  func: joblist,
};
