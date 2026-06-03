/**
 * 猎聘人才库命令 - 走 LPT 招聘者端
 *
 * 关键变更 (修复 404):
 *   - 旧: navigateTo(www.liepin.com/talent) + liepinFetch(api-c.liepin.com/...pc-talent-list)
 *   - 新: navigateToLpt(lpt.liepin.com/resume/apply) + lptFetch(api-lpt.liepin.com/...rapply.platform.e.serch-by-usere.v2)
 *   LPT 上"人才管理"是 /resume/apply，对应接口是 rapply 的 serch-by-usere.v2，
 *   实际语义是"投递到我的职位的候选人"（apply 列表），跟旧 talent 库语义有差。
 */

import { Page } from 'puppeteer-core';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt } from '../common/lpt-utils.js';

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

  // 导航到 LPT 人才管理（投递候选人列表）页面
  await navigateToLpt(page, '/resume/apply', 2);

  // LPT BFF: /api/com.liepin.rapply.platform.e.serch-by-usere.v2
  // 真实 body 是 url-encoded form，applyCondition 字段是 JSON 字符串
  const applyCondition: Record<string, any> = {
    curPage: Math.max(pageNum - 1, 0),
    pageSize: Math.min(limit, 40),
    name: query,
    title: '',
    company: '',
    sortflag: '',
    sex: '0',
    ageLow: '',
    ageHigh: '',
    workyearLow: experience ? experience.split('-')[0] : '',
    workyearHigh: experience && experience.includes('-') ? experience.split('-')[1] : '',
    eduLevelLow: '',
    eduLevelHigh: '005',
    readflag: '',
    applyStatus: 0,
    dqCode: city,
    applyTimeRange: '0',
    jobId: '',
    politicCodes: null,
  };
  const form = new URLSearchParams();
  form.set('applyCondition', JSON.stringify(applyCondition));

  const data = await lptFetch(
    page,
    `${LIEPIN_LPT_API}/api/com.liepin.rapply.platform.e.serch-by-usere.v2`,
    { body: form.toString() },
  );

  if (data.flag !== 1) {
    throw new Error(`获取人才列表失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  const candidates = data.data?.datas || data.data?.list || [];
  if (!Array.isArray(candidates)) {
    throw new Error('获取人才列表失败: 响应格式异常 (无 datas)');
  }

  return candidates.map((item: any) => ({
    name: item.name || item.showName || '',
    title: item.title || '',  // 候选人当前职位
    company: item.compName || '',
    salary: '',  // 该接口不直接返回当前薪资
    experience: item.workYearsDescr || (item.workYears ? `${item.workYears}年` : ''),
    education: item.degreeName || '',
    city: item.dqName || '',
    age: String(item.age || ''),
    school: item.school || '',
    // 状态：applyStatus (0=待处理) / jobStatus (13=招聘中) 等
    status: item.applyStatus === 0 ? '待处理' : (item.jobStatus || ''),
    // 附加信息
    apply_job: item.jobName || '',  // 投递的岗位
    apply_time: item.createTime || '',
    resume_id: String(item.resIdEncode || ''),
    user_id: String(item.usercIdEncode || ''),
    im_id: String(item.imId || ''),
    talentId: String(item.resIdEncode || ''),
  }));
}

/** 人才列表命令定义 */
export const talentCommand = {
  name: 'talent',
  description: '查看人才库（LPT 投递候选人列表）',
  args: [
    { name: 'query', type: 'string', default: '', help: '搜索关键词' },
    { name: 'city', type: 'string', default: '', help: '城市' },
    { name: 'experience', type: 'string', default: '', help: '工作经验' },
    { name: 'salary', type: 'string', default: '', help: '薪资范围' },
    { name: 'degree', type: 'string', default: '', help: '学历' },
    { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-40）' },
  ],
  columns: [
    { header: '姓名', key: 'name', width: 12 },
    { header: '当前职位', key: 'title', width: 18 },
    { header: '公司', key: 'company', width: 18 },
    { header: '经验', key: 'experience', width: 10 },
    { header: '学历', key: 'education', width: 8 },
    { header: '城市', key: 'city', width: 10 },
    { header: '学校', key: 'school', width: 20 },
    { header: '投递岗位', key: 'apply_job', width: 18 },
    { header: '状态', key: 'status', width: 10 },
  ],
  func: talent,
};
