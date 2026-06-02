import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginCommand } from './login.js';
import { searchCommand } from './search.js';
import { detailCommand } from './detail.js';
import { companyCommand } from './company.js';
import { chatlistCommand } from './chatlist.js';
import { chatmsgCommand } from './chatmsg.js';
import { recommendCommand } from './recommend.js';
import { talentCommand } from './talent.js';
import { resumeCommand } from './resume.js';
import { greetCommand } from './greet.js';
import { joblistCommand } from './joblist.js';
import { skillCommand } from './skill.js';

interface CommandArg {
  name: string;
  type: string;
  required?: boolean;
  positional?: boolean;
  default?: unknown;
  help: string;
}

interface CommandShape {
  name: string;
  description: string;
  args: CommandArg[];
  columns: Array<{ header: string; key: string; width: number }>;
  requiresPage?: boolean;
  func: (...args: any[]) => any;
}

const allCommands: CommandShape[] = [
  loginCommand, searchCommand, detailCommand, companyCommand,
  chatlistCommand, chatmsgCommand, recommendCommand, talentCommand,
  resumeCommand, greetCommand, joblistCommand, skillCommand,
];

test('所有命令名唯一', () => {
  const names = allCommands.map(c => c.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, `重复的命令名: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});

test('每个命令都有 name / description / args / columns / func', () => {
  for (const c of allCommands) {
    assert.ok(c.name && typeof c.name === 'string', `${c.name}: name 缺失或非 string`);
    assert.ok(c.description && typeof c.description === 'string', `${c.name}: description 缺失或非 string`);
    assert.ok(Array.isArray(c.args), `${c.name}: args 不是数组`);
    assert.ok(Array.isArray(c.columns), `${c.name}: columns 不是数组`);
    assert.equal(typeof c.func, 'function', `${c.name}: func 不是函数`);
  }
});

test('required args 必须是 positional（否则命令行无法传入）', () => {
  for (const c of allCommands) {
    for (const arg of c.args) {
      if (arg.required) {
        assert.ok(arg.positional, `${c.name}.args.${arg.name} 是 required 但没有 positional=true，CLI 解析不到`);
      }
    }
  }
});

test('skill 命令 requiresPage: false（不启动浏览器）', () => {
  assert.equal(skillCommand.requiresPage, false);
});

test('其它命令 requiresPage 默认为 true（即 undefined 或 true）', () => {
  for (const c of allCommands) {
    if (c.name === 'skill') continue;
    assert.notEqual(c.requiresPage, false, `${c.name} 显式设了 requiresPage: false，请确认是否需要`);
  }
});

test('至少注册 12 个命令（防止删命令时漏更新测试）', () => {
  assert.ok(allCommands.length >= 12, `只有 ${allCommands.length} 个命令`);
});

test('每个命令至少有一行 columns', () => {
  for (const c of allCommands) {
    assert.ok(c.columns.length > 0, `${c.name}: columns 为空`);
  }
});
