import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeCommand } from './resume.js';

function fakeResumePage(resumeDetailVo: any) {
  const requests: Array<{ url: string; body: string }> = [];
  const page = {
    url: () => 'https://lpt.liepin.com/search',
    evaluate: async (_fn: unknown, url?: string, body?: string) => {
      if (!url) return page.url();
      requests.push({ url, body: body || '' });
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ flag: 1, data: { resumeDetailVo } }),
      };
    },
  };
  return { page: page as any, requests };
}

test('resume: 工作经历优先显示职位文本而非职位编码，保留年月、时长和职责', async () => {
  const { page, requests } = fakeResumePage({
    resId: 'resume-id',
    workExperiences: [{
      title: '海外品牌推广专员',
      jobTitleName: 'N000305',
      compName: '示例公司',
      startShow: '2025.10',
      endShow: '至今',
      timespan: '1年',
      duty: '负责品牌推广\n维护内容渠道',
    }],
  });
  const result = await resumeCommand.func(page, { talentId: 'resume-id' });

  assert.equal(result.work_history, '2025.10-至今 1年 示例公司 / 海外品牌推广专员\n负责品牌推广\n维护内容渠道');
  assert.equal(result.resume_id, 'resume-id');
  assert.equal(requests.length, 1);
  const body = JSON.parse(new URLSearchParams(requests[0].body).get('pageParamVo') || '{}');
  assert.deepEqual(body, { resIdEncode: 'resume-id', sfrom: 'R_SEARCH_CONDITION' });
});

test('resume: 教育经历保留起止年月、学制和院校专业', async () => {
  const { page } = fakeResumePage({
    eduExperiences: [{
      startShow: '2020.09',
      endShow: '2024.06',
      eduTimeSpan: '4年',
      school: '示例大学',
      special: '计算机科学',
      degreeName: '本科',
    }],
  });
  const result = await resumeCommand.func(page, { talentId: 'resume-id' });

  assert.equal(result.education_history, '2020.09-2024.06 4年 示例大学 / 计算机科学 / 本科');
  assert.equal(result.education, '本科');
});

test('resume: 缺起止年月或职位文本时仍保留已有信息', async () => {
  const { page } = fakeResumePage({
    workExperiences: [{
      jobTitleName: '已有职位名称',
      compName: '示例公司',
      timespan: '8个月',
      duty: '已有职责',
    }],
    eduExperiences: [{
      eduTimeSpan: '3年',
      school: '示例学院',
      special: '软件技术',
      degreeName: '大专',
    }],
  });
  const result = await resumeCommand.func(page, { talentId: 'resume-id' });

  assert.equal(result.work_history, '8个月 示例公司 / 已有职位名称\n已有职责');
  assert.equal(result.education_history, '3年 示例学院 / 软件技术 / 大专');
  assert.equal(result.resume_id, 'resume-id');
});

test('resume: 缺经历列表时返回空字段', async () => {
  const { page } = fakeResumePage({});
  const result = await resumeCommand.func(page, { talentId: 'resume-id' });
  assert.equal(result.work_history, '');
  assert.equal(result.education_history, '');
});
