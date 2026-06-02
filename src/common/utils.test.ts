import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCity, resolveCode, resolveSalary,
  CITY_CODES, WORKYEAR_CODES, DEGREE_CODES, INDUSTRY_CODES,
  COMPSIZE_CODES, JOBKIND_CODES, SALARY_CODES, YEARSALARY_CODES,
} from '../common/utils.js';

test('resolveCity: 已知中文城市映射到代码', () => {
  assert.equal(resolveCity('北京'), '010');
  assert.equal(resolveCity('上海'), '020');
  assert.equal(resolveCity('深圳'), '050090');
});

test('resolveCity: 全国映射到 410', () => {
  assert.equal(resolveCity('全国'), '410');
  assert.equal(resolveCity('all'), '410');
});

test('resolveCity: 空字符串默认 410', () => {
  assert.equal(resolveCity(''), '410');
});

test('resolveCity: 未知城市透传', () => {
  assert.equal(resolveCity('火星'), '火星');
});

test('resolveCode: 已知经验值映射', () => {
  assert.equal(resolveCode('3-5年', WORKYEAR_CODES), '3$5');
  assert.equal(resolveCode('应届', WORKYEAR_CODES), '1');
  assert.equal(resolveCode('不限', WORKYEAR_CODES), '');
});

test('resolveCode: 空字符串返回空', () => {
  assert.equal(resolveCode('', WORKYEAR_CODES), '');
  assert.equal(resolveCode('', DEGREE_CODES), '');
});

test('resolveCode: 未知值透传', () => {
  assert.equal(resolveCode('XYZ', WORKYEAR_CODES), 'XYZ');
});

test('resolveSalary: 已知区间', () => {
  assert.deepEqual(resolveSalary('20-30K'), { low: '20', high: '30' });
  assert.deepEqual(resolveSalary('3-5K'), { low: '3', high: '5' });
});

test('resolveSalary: 边界值（50K 以上 high 为空）', () => {
  assert.deepEqual(resolveSalary('50K以上'), { low: '50', high: '' });
  assert.deepEqual(resolveSalary('3K以下'), { low: '0', high: '3' });
});

test('resolveSalary: 空字符串和未知值', () => {
  assert.deepEqual(resolveSalary(''), { low: '', high: '' });
  assert.deepEqual(resolveSalary('XYZ'), { low: '', high: '' });
});

test('CITY_CODES: 至少 30 个城市', () => {
  assert.ok(Object.keys(CITY_CODES).length >= 30, `只有 ${Object.keys(CITY_CODES).length} 个城市`);
});

test('所有代码映射表的 value 都是 string', () => {
  const maps = {
    CITY_CODES, WORKYEAR_CODES, DEGREE_CODES, INDUSTRY_CODES,
    COMPSIZE_CODES, JOBKIND_CODES, YEARSALARY_CODES,
  };
  for (const [name, map] of Object.entries(maps)) {
    for (const [k, v] of Object.entries(map)) {
      assert.equal(typeof v, 'string', `${name}.${k} 应该是 string，实际是 ${typeof v}`);
    }
  }
});

test('SALARY_CODES: 所有 entry 都有 low/high string 字段', () => {
  for (const [k, v] of Object.entries(SALARY_CODES)) {
    assert.equal(typeof v.low, 'string', `SALARY_CODES.${k}.low 不是 string`);
    assert.equal(typeof v.high, 'string', `SALARY_CODES.${k}.high 不是 string`);
  }
});

test('INDUSTRY_CODES: 包含核心行业', () => {
  assert.ok('互联网' in INDUSTRY_CODES);
  assert.ok('金融' in INDUSTRY_CODES);
  assert.ok('人工智能' in INDUSTRY_CODES);
});
