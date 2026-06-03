/**
 * 猎聘简历详情命令 - 招聘者端
 *
 * 走 LPT 接口 com.liepin.rresume.usere.pc.resume-view（抓包确认）：
 *   body: pageParamVo={"resIdEncode":"<简历ID>","sfrom":"R_SEARCH_CONDITION"}
 *   resp: data.resumeDetailVo { baseInfo, jobWant, eduExperiences[], workExperiences[], ... }
 * talentId 即 search 返回的 resume_id（resIdEncode）。
 */

import { Page } from 'puppeteer-core';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt } from '../common/lpt-utils.js';

export interface ResumeOptions {
  talentId: string;
}

function joinLines(items: any[], fmt: (it: any) => string): string {
  return (items || []).map(fmt).filter(Boolean).join('\n');
}

export async function resume(page: Page, options: ResumeOptions): Promise<any> {
  const { talentId } = options;

  if (!talentId) {
    throw new Error('简历 ID（resIdEncode）不能为空');
  }

  // 在 LPT 搜索页下发起请求（带正确 cookie / referer）
  const currentUrl = await page.evaluate(() => window.location.href);
  if (!String(currentUrl).includes('lpt.liepin.com')) {
    await navigateToLpt(page, '/search', 2);
  }

  const form = new URLSearchParams();
  form.set('pageParamVo', JSON.stringify({
    resIdEncode: talentId,
    sfrom: 'R_SEARCH_CONDITION',
  }));

  const data = await lptFetch(
    page,
    `${LIEPIN_LPT_API}/api/com.liepin.rresume.usere.pc.resume-view`,
    { body: form.toString() },
  );

  if (data.flag !== 1) {
    throw new Error(`获取简历失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  const vo = data.data?.resumeDetailVo;
  if (!vo) {
    throw new Error('获取简历失败: 响应缺少 resumeDetailVo（可能简历 ID 无效或无查看权限）');
  }

  const base = vo.baseInfo || {};
  const want = vo.jobWant || {};

  return {
    name: base.name || '',
    title: base.title || '',
    sex: base.sexName || '',
    age: base.age ? `${base.age}岁` : '',
    city: base.dqName || '',
    experience: base.workYearsDescr || '',
    education: vo.eduExperiences?.[0]?.degreeName || '',
    current_company: base.company || '',
    industry: base.industryName || '',
    work_status: base.workStatusName || '',
    online_status: vo.onlineDesc || '',
    want_salary: want.salaryShow || base.salaryShow || '',
    want_city: (want.dqNames || []).join('、'),
    want_title: (want.jobTitleNames || []).join('、'),
    want_industry: (want.industryNames || []).join('、'),
    self_descr: vo.selfDescr || '',
    skills: (vo.credentialNames || []).join('、'),
    languages: joinLines(vo.languages, (l: any) => l.nameShow || ''),
    work_history: joinLines(vo.workExperiences, (w: any) =>
      `${w.timespan || ''} ${w.compName || ''} / ${w.jobTitleName || w.title || ''}`.trim()),
    education_history: joinLines(vo.eduExperiences, (e: any) =>
      `${e.eduTimeSpan || ''} ${e.school || ''} / ${e.special || ''} / ${e.degreeName || ''}`.trim()),
    resume_id: String(vo.resId || talentId),
    user_id: String(vo.encodeUsercId || ''),
  };
}

/** 简历命令定义 */
export const resumeCommand = {
  name: 'resume',
  description: '查看简历详情（招聘者端，传 search 返回的 resume_id）',
  args: [
    { name: 'talentId', type: 'string', required: true, positional: true, help: '简历 ID（resIdEncode，来自 search 结果）' },
  ],
  columns: [
    { header: '字段', key: 'field', width: 15 },
    { header: '内容', key: 'value', width: 80 },
  ],
  func: resume,
};
