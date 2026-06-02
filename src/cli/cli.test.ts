import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, 'index.js');

test('无参数: 显示 help，列出所有命令', async () => {
  const { stdout } = await exec('node', [CLI]);
  assert.match(stdout, /skill/);
  assert.match(stdout, /--json/);
  for (const cmd of ['login', 'search', 'detail', 'company', 'chatlist', 'chatmsg', 'recommend', 'talent', 'resume', 'greet', 'joblist']) {
    assert.match(stdout, new RegExp(`^\\s+${cmd}\\s+`, 'm'), `缺少命令: ${cmd}`);
  }
});

test('--version: 输出版本号', async () => {
  const { stdout } = await exec('node', [CLI, '--version']);
  assert.equal(stdout.trim(), 'liepin-cli v0.1.0');
});

test('--help: 显示完整 help（含 --json）', async () => {
  const { stdout } = await exec('node', [CLI, '--help']);
  assert.match(stdout, /--json/);
  assert.match(stdout, /AI Agent 友好/);
});

test('未知命令: 报错并退出码 1', async () => {
  await assert.rejects(
    () => exec('node', [CLI, 'nonexistent-command-xxx']),
    (err: any) => {
      assert.equal(err.code, 1, `期望退出码 1，实际 ${err.code}`);
      assert.match(err.stderr, /未知命令/);
      return true;
    },
  );
});

test('skill --json: 输出有效 JSON', async () => {
  const { stdout } = await exec('node', [CLI, 'skill', '--json']);
  const data = JSON.parse(stdout);
  assert.equal(data.success, true);
  assert.ok(data.files_copied >= 1);
  assert.ok(data.target.endsWith('/.claude/skills/liepin-cli'));
});

test('skill (默认 text 模式): 包含关键字段', async () => {
  const { stdout } = await exec('node', [CLI, 'skill']);
  assert.match(stdout, /success: true/);
  assert.match(stdout, /files_copied: \d+/);
  assert.match(stdout, /Skill 已安装到/);
});

test('-h 等价于 --help', async () => {
  const { stdout } = await exec('node', [CLI, '-h']);
  assert.match(stdout, /--json/);
  assert.match(stdout, /命令:/);
});
