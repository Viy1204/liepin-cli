import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchBody, mapJobCard, resolveUserStatus, resolveAgeRange } from './search.js';

function parseSearchBody(body: string) {
  const params = new URLSearchParams(body);
  return {
    cv: JSON.parse(params.get('cvSearchConditionInputVo') || '{}'),
    log: JSON.parse(params.get('logForm') || '{}'),
  };
}

test('buildSearchBody: 默认构造招聘者端人才搜索表单', () => {
  const { cv, log } = parseSearchBody(buildSearchBody({}));
  assert.equal(cv.curPage, 0);
  assert.equal(cv.keys, '');
  assert.equal(cv.dqs, '');
  assert.equal(cv.workyears, '0,99');
  assert.deepEqual(cv.eduLevels, []);
  assert.equal(cv.interactiveVersion, 'v2');
  assert.equal(cv.titleSearchFilter, '0');
  assert.equal(cv.compSearchFilter, '0');
  assert.equal(log.searchScene, 'button');
  assert.equal(typeof log.ckId, 'string');
});

test('buildSearchBody: 关键词和页码透传', () => {
  const { cv } = parseSearchBody(buildSearchBody({
    key: '产品经理',
    currentPage: 2,
  }));
  assert.equal(cv.keys, '产品经理');
  assert.equal(cv.curPage, 2);
});

test('buildSearchBody: 常用筛选条件透传', () => {
  const { cv } = parseSearchBody(buildSearchBody({
    city: '050090',
    key: '前端',
    workYearCode: '3,5',
    eduLevel: '040',
    industry: '010',
    salaryLow: '240',
    salaryHigh: '360',
  }));
  assert.equal(cv.dqs, '050090');
  assert.equal(cv.keys, '前端');
  assert.equal(cv.workyears, '3,5');
  assert.deepEqual(cv.eduLevels, ['040']);
  assert.equal(cv.industrys, '010');
  assert.equal(cv.wantYearSalaryLow, '240');
  assert.equal(cv.wantYearSalaryHigh, '360');
});

test('buildSearchBody: userStatus/age 透传（issue #10）', () => {
  const { cv } = parseSearchBody(buildSearchBody({
    userStatus: '1,2,7',
    age: '25,35',
  }));
  assert.equal(cv.userStatus, '1,2,7');
  assert.equal(cv.age, '25,35');
});

test('buildSearchBody: 未传 userStatus/age 时保持空串', () => {
  const { cv } = parseSearchBody(buildSearchBody({}));
  assert.equal(cv.userStatus, '');
  assert.equal(cv.age, '');
});

test('resolveUserStatus: 合法多选规范化，空串不限', () => {
  assert.equal(resolveUserStatus(''), '');
  assert.equal(resolveUserStatus('3'), '3');
  assert.equal(resolveUserStatus(' 1, 2 ,7 '), '1,2,7');
});

test('resolveUserStatus: 越界/非法码报错并带码表', () => {
  assert.throws(() => resolveUserStatus('8'), /--user-status 取值无效/);
  assert.throws(() => resolveUserStatus('0'), /码表/);
  assert.throws(() => resolveUserStatus('abc'), /--user-status 取值无效/);
  assert.throws(() => resolveUserStatus(','), /--user-status 取值无效/);
});

test('resolveAgeRange: 合法区间规范化，空串不限', () => {
  assert.equal(resolveAgeRange(''), '');
  assert.equal(resolveAgeRange('25,35'), '25,35');
  assert.equal(resolveAgeRange(' 25 , 35 '), '25,35');
});

test('resolveAgeRange: 非法格式与倒置区间报错', () => {
  assert.throws(() => resolveAgeRange('25'), /--age 格式无效/);
  assert.throws(() => resolveAgeRange('25-35'), /--age 格式无效/);
  assert.throws(() => resolveAgeRange('35,25'), /--age 区间无效/);
});

test('buildSearchBody: 输出 application/x-www-form-urlencoded 需要的两个字段', () => {
  const params = new URLSearchParams(buildSearchBody({ key: 'Java' }));
  assert.ok(params.has('cvSearchConditionInputVo'));
  assert.ok(params.has('logForm'));
});

test('mapJobCard: 完整候选人数据映射', () => {
  const item = {
    resName: '易**',
    wantJobTitle: '金融产品经理',
    wantSalary: '50-100K',
    wantDq: '上海',
    workYearsShow: '11年',
    resEdulevelName: 'MBA/EMBA',
    ageShow: '35岁',
    activeStatus: { name: '在线' },
    resIdEncode: '87f37e7293Ye6d6fb81459d',
    usercId: 'user-1',
    imId: 'im-1',
    resumeUrl: 'https://lpt.liepin.com/cvview/showresumedetail?resIdEncode=xxx',
    workExpList: [
      {
        title: 'Product Manager, AI & Trading',
        compName: 'AInvest',
      },
    ],
    eduExpList: [
      {
        schoolName: '卡内基梅隆大学',
        eduDegreeName: 'MBA/EMBA',
      },
    ],
  };
  const result = mapJobCard(item, 1);
  assert.equal(result.rank, 1);
  assert.equal(result.name, '易**');
  assert.equal(result.title, '金融产品经理');
  assert.equal(result.salary, '50-100K');
  assert.equal(result.city, '上海');
  assert.equal(result.experience, '11年');
  assert.equal(result.degree, 'MBA/EMBA');
  assert.equal(result.company, 'AInvest');
  assert.equal(result.current_title, 'Product Manager, AI & Trading');
  assert.equal(result.school, '卡内基梅隆大学');
  assert.equal(result.age, '35岁');
  assert.equal(result.active_status, '在线');
  assert.equal(result.resume_id, '87f37e7293Ye6d6fb81459d');
  assert.equal(result.user_id, 'user-1');
  assert.equal(result.im_id, 'im-1');
  assert.match(result.url, /cvview/);
});

test('mapJobCard: 缺期望职位时回退到最近工作职位', () => {
  const result = mapJobCard({
    workExpList: [{ title: '后端工程师', compName: 'Beta' }],
  }, 5);
  assert.equal(result.rank, 5);
  assert.equal(result.title, '后端工程师');
  assert.equal(result.company, 'Beta');
});

test('mapJobCard: 空对象不抛错并返回空字符串字段', () => {
  const result = mapJobCard({}, 1);
  assert.equal(result.name, '');
  assert.equal(result.title, '');
  assert.equal(result.salary, '');
  assert.equal(result.city, '');
  assert.equal(result.resume_id, '');
});
