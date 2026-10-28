import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendCommand } from './recommend.js';

function fakeRecommendPage(resumes: any[]) {
  return {
    url: () => 'https://lpt.liepin.com/recommend',
    goto: async () => {},
    evaluate: async (_fn: unknown, url: string) => {
      const data = url.endsWith('.init')
        ? { ejobId: 123 }
        : { list: resumes.map(resume => ({ resume, job: { jobId: 123 } })) };
      return { ok: true, status: 200, text: JSON.stringify({ flag: 1, data }) };
    },
  } as any;
}

test('recommend: 从绝对和相对简历 URL 输出 resume_id，保留原有标识', async () => {
  const candidates = await recommendCommand.func(fakeRecommendPage([
    {
      enresId: 'recommend-record-id',
      enusercId: 'candidate-user-id',
      url: 'https://lpt.liepin.com/cvview/showresumedetail?&sfrom=R_HOMEPAGE_RECMD&resIdEncode=resume%2Bid',
    },
    { url: '/cvview/showresumedetail?resIdEncode=relative-resume-id' },
  ]), { limit: 2 });

  assert.equal(candidates[0].resume_id, 'resume+id');
  assert.equal(candidates[0].talentId, 'recommend-record-id');
  assert.equal(candidates[0].user_id, 'candidate-user-id');
  assert.match(candidates[0].url, /sfrom=R_HOMEPAGE_RECMD/);
  assert.equal(candidates[1].resume_id, 'relative-resume-id');
});

test('recommend: 缺 URL 或缺 resIdEncode 时不拿其他 ID 充当 resume_id', async () => {
  const candidates = await recommendCommand.func(fakeRecommendPage([
    { enresId: 'recommend-record-id', enusercId: 'candidate-user-id' },
    { url: '/cvview/showresumedetail?usercIdEncode=candidate-user-id' },
    { url: '/cvview/showresumedetail?resIdEncode=' },
  ]), { limit: 3 });

  assert.deepEqual(candidates.map(candidate => candidate.resume_id), ['', '', '']);
});

test('recommend: 非法 URL 报错，不伪造简历 ID', async () => {
  await assert.rejects(
    () => recommendCommand.func(fakeRecommendPage([{ url: 'https://[' }]), { limit: 1 }),
    /Invalid URL|简历 URL/,
  );
});

test('recommend: 表格保留完整 resume_id 供后续命令使用', () => {
  const column = recommendCommand.columns.find(item => item.key === 'resume_id');
  assert.ok(column);
  assert.equal('noTruncate' in column && column.noTruncate, true);
});
