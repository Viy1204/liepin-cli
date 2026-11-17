import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, 'index.js');

function makeSkillTarget(): string {
  return mkdtempSync(join(tmpdir(), 'liepin-cli-skill-'));
}

function makeRiskFixture(options: {
  failure?: 'Error' | 'AuthExpiredError' | 'RiskControlError' | 'PageUnavailableError';
  persistenceFailure?: boolean;
  competingStop?: boolean;
} = {}) {
  const target = mkdtempSync(join(tmpdir(), 'liepin-cli-risk-'));
  const configDir = join(target, 'config');
  const callsPath = join(target, 'calls.log');
  const fixturePath = join(target, 'fixture.mjs');
  mkdirSync(configDir);
  writeFileSync(callsPath, '');
  writeFileSync(fixturePath, `
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { CdpBrowser } from ${JSON.stringify(pathToFileURL(join(__dirname, '..', 'browser', 'cdp_browser.js')).href)};
import { AuthExpiredError, PageUnavailableError, RiskControlError } from ${JSON.stringify(pathToFileURL(join(__dirname, '..', 'common', 'lpt-utils.js')).href)};
import { quitCommand } from ${JSON.stringify(pathToFileURL(join(__dirname, '..', 'toolset', 'quit.js')).href)};
CdpBrowser.prototype.launch = async function () {
  appendFileSync(${JSON.stringify(callsPath)}, 'launch\\n');
  if (${options.persistenceFailure === true}) {
    rmSync(${JSON.stringify(configDir)}, { recursive: true, force: true });
    writeFileSync(${JSON.stringify(configDir)}, 'fixture blocks persistence');
  }
  if (${options.competingStop === true}) {
    writeFileSync(${JSON.stringify(join(configDir, 'risk-stop.json'))},
      JSON.stringify({ version: 1, stoppedAt: '2000-01-01T00:00:00.000Z', command: 'greet' }), { flag: 'wx' });
  }
  throw new ${options.failure ?? 'RiskControlError'}('fixture risk signal');
};
CdpBrowser.prototype.disconnect = function () {
  appendFileSync(${JSON.stringify(callsPath)}, 'disconnect\\n');
};
globalThis.fetch = async function () {
  appendFileSync(${JSON.stringify(callsPath)}, 'probe\\n');
  throw new Error('fixture forbids network access');
};
quitCommand.func = async function () {
  appendFileSync(${JSON.stringify(callsPath)}, 'quit\\n');
  return { success: true };
};
`);
  const env = {
    ...process.env,
    LIEPIN_CONFIG_DIR: configDir,
    LIEPIN_USER_DATA_DIR: join(target, 'user-data'),
    LIEPIN_SKILL_TARGET_DIR: join(target, 'skills'),
    HOME: target,
    USERPROFILE: target,
  };
  return {
    stopPath: join(configDir, 'risk-stop.json'),
    busyPath: join(target, '.recruit-browser', 'liepin.busy.json'),
    run: (...args: string[]) => exec(process.execPath, ['--import', pathToFileURL(fixturePath).href, CLI, ...args], {
      cwd: target, env, timeout: 10000,
    }),
    calls: () => readFileSync(callsPath, 'utf8').split('\n').filter(Boolean),
    cleanup: () => rmSync(target, { recursive: true, force: true }),
  };
}

test('无参数: 显示 help，列出所有命令', async () => {
  const { stdout } = await exec('node', [CLI]);
  assert.match(stdout, /skill/);
  assert.match(stdout, /--json/);
  for (const cmd of ['login', 'search', 'chatlist', 'chatmsg', 'recommend', 'talent', 'resume', 'greet',
    'request-phone', 'request-resume', 'joblist']) {
    assert.match(stdout, new RegExp(`^\\s+${cmd}\\s+`, 'm'), `缺少命令: ${cmd}`);
  }
});

test('--version: 输出版本号', async () => {
  const { stdout } = await exec('node', [CLI, '--version']);
  assert.match(stdout.trim(), /^liepin-cli v\d+\.\d+\.\d+$/);
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
  const target = makeSkillTarget();
  try {
    const { stdout } = await exec('node', [CLI, 'skill', '--json'], {
      env: { ...process.env, LIEPIN_SKILL_TARGET_DIR: target },
    });
    const data = JSON.parse(stdout);
    assert.equal(data.success, true);
    assert.ok(data.files_copied >= 1);
    assert.equal(data.target, target);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('skill (默认 text 模式): 包含关键字段', async () => {
  const target = makeSkillTarget();
  try {
    const { stdout } = await exec('node', [CLI, 'skill'], {
      env: { ...process.env, LIEPIN_SKILL_TARGET_DIR: target },
    });
    assert.match(stdout, /success: true/);
    assert.match(stdout, /files_copied: \d+/);
    assert.match(stdout, /Skill 已安装到/);
    assert.match(stdout, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('-h 等价于 --help', async () => {
  const { stdout } = await exec('node', [CLI, '-h']);
  assert.match(stdout, /--json/);
  assert.match(stdout, /命令:/);
});

test('help 子命令等价于 --help', async () => {
  const { stdout } = await exec('node', [CLI, 'help']);
  assert.match(stdout, /命令:/);
  assert.match(stdout, /--json/);
});

test('issue27 跨进程停止', async () => {
  const fixture = makeRiskFixture();
  try {
    await assert.rejects(fixture.run('recommend', '--json'), { code: 3 });
    assert.ok(existsSync(fixture.stopPath), '首次风控退出前应写入停止记录');
    const record = JSON.parse(readFileSync(fixture.stopPath, 'utf8'));
    assert.equal(record.version, 1);
    assert.equal(record.command, 'recommend');
    assert.equal(typeof record.stoppedAt, 'string');
    assert.equal(new Date(record.stoppedAt).toISOString(), record.stoppedAt);
    const firstCalls = fixture.calls();
    assert.equal(firstCalls.filter(call => call === 'launch').length, 1);
    assert.equal(firstCalls.filter(call => call === 'disconnect').length, 1, '风控退出也应完成断连清理');
    assert.equal(firstCalls.filter(call => call === 'probe').length, 0);

    for (const args of [['chatlist', '--json'], ['login', '--force', '--json']]) {
      await assert.rejects(fixture.run(...args), { code: 3 });
      assert.deepEqual(fixture.calls().filter(call => call === 'launch' || call === 'probe'), ['launch']);
      assert.deepEqual(JSON.parse(readFileSync(fixture.stopPath, 'utf8')), record, '保留首次信号，不被后续命令覆盖');
    }
  } finally { fixture.cleanup(); }
});

test('issue27 记录拒绝', async () => {
  for (const content of [
    JSON.stringify({ version: 1, stoppedAt: '2000-01-01T00:00:00.000Z', command: 'greet' }),
    '{broken json',
    JSON.stringify({ version: 1 }),
  ]) {
    const fixture = makeRiskFixture();
    try {
      writeFileSync(fixture.stopPath, content);
      for (const args of [['chatlist', '--json'], ['login', '--force', '--json']]) {
        await assert.rejects(fixture.run(...args), { code: 3 });
      }
      assert.deepEqual(fixture.calls().filter(call => call === 'launch' || call === 'probe'), []);
      assert.equal(readFileSync(fixture.stopPath, 'utf8'), content, '已有或损坏记录都不得自动到期或被覆盖');
    } finally { fixture.cleanup(); }
  }
});

test('issue27 离线管理', async () => {
  const fixture = makeRiskFixture();
  const record = { version: 1, stoppedAt: '2000-01-01T00:00:00.000Z', command: 'greet' };
  try {
    writeFileSync(fixture.stopPath, JSON.stringify(record));
    for (const args of [[], ['--help'], ['help'], ['--version'], ['skill', '--json'], ['quit', '--json']]) {
      await fixture.run(...args);
    }
    const { stdout } = await fixture.run('risk', '--json');
    assert.equal(JSON.parse(stdout).blocked, true);
    assert.ok(fixture.calls().includes('quit'), '停止后仍应允许执行 quit 的本地清理');
    assert.deepEqual(fixture.calls().filter(call => call === 'launch' || call === 'probe'), []);
    assert.deepEqual(JSON.parse(readFileSync(fixture.stopPath, 'utf8')), record);
  } finally { fixture.cleanup(); }
});

test('issue27 显式清除', async () => {
  for (const content of [
    JSON.stringify({ version: 1, stoppedAt: '2000-01-01T00:00:00.000Z', command: 'greet' }),
    '{broken json',
  ]) {
    const fixture = makeRiskFixture();
    try {
      writeFileSync(fixture.stopPath, content);
      const status = await fixture.run('risk', '--json');
      assert.equal(JSON.parse(status.stdout).blocked, true);
      await fixture.run('risk', '--clear=false', '--json').catch((error: any) => {
        assert.equal(error.code, 1);
      });
      assert.equal(readFileSync(fixture.stopPath, 'utf8'), content, '--clear=false 不得清除停止记录');

      const cleared = await fixture.run('risk', '--clear', '--json');
      assert.equal(JSON.parse(cleared.stdout).blocked, false);
      assert.equal(existsSync(fixture.stopPath), false);
      const after = await fixture.run('risk', '--json');
      assert.equal(JSON.parse(after.stdout).blocked, false);
      assert.deepEqual(fixture.calls().filter(call => call === 'launch' || call === 'probe'), [], '状态和清除操作不得探测或启动浏览器');
    } finally { fixture.cleanup(); }
  }
});

test('issue27 全部页面命令准入', async () => {
  const fixture = makeRiskFixture();
  const busy = JSON.stringify({ pid: process.pid, command: 'other process', startedAt: Date.now() });
  try {
    writeFileSync(fixture.stopPath, JSON.stringify({ version: 1, stoppedAt: '2000-01-01T00:00:00.000Z', command: 'greet' }));
    mkdirSync(dirname(fixture.busyPath), { recursive: true });
    writeFileSync(fixture.busyPath, busy);
    for (const command of ['login', 'search', 'chatlist', 'chatmsg', 'recommend', 'talent', 'resume',
      'greet', 'request-phone', 'request-resume', 'joblist']) {
      await assert.rejects(fixture.run(command, '--json'), { code: 3 });
    }
    assert.deepEqual(fixture.calls(), []);
    assert.equal(readFileSync(fixture.busyPath, 'utf8'), busy, '准入失败不能清除其他进程的 busy 提示');
  } finally { fixture.cleanup(); }
});

test('issue27 普通错误不生成停止记录', async () => {
  for (const [failure, code] of [['Error', 1], ['AuthExpiredError', 2]] as const) {
    const fixture = makeRiskFixture({ failure });
    try {
      for (const command of ['recommend', 'chatlist']) {
        await assert.rejects(fixture.run(command, '--json'), { code });
        assert.equal(existsSync(fixture.stopPath), false);
      }
      assert.deepEqual(fixture.calls(), ['launch', 'disconnect', 'launch', 'disconnect']);
    } finally { fixture.cleanup(); }
  }
});

test('issue27 页面失效也持久停止', async () => {
  const fixture = makeRiskFixture({ failure: 'PageUnavailableError' });
  try {
    await assert.rejects(fixture.run('recommend', '--json'), { code: 3 });
    const record = JSON.parse(readFileSync(fixture.stopPath, 'utf8'));
    assert.deepEqual(Object.keys(record).sort(), ['command', 'stoppedAt', 'version']);
    assert.equal(record.command, 'recommend');
    await assert.rejects(fixture.run('login', '--force', '--json'), { code: 3 });
    assert.deepEqual(fixture.calls(), ['launch', 'disconnect']);
  } finally { fixture.cleanup(); }
});

test('issue27 写入失败仍退出 3 并清理', async () => {
  const fixture = makeRiskFixture({ persistenceFailure: true });
  try {
    await assert.rejects(fixture.run('recommend', '--json'), (error: any) => {
      assert.equal(error.code, 3);
      assert.match(error.stderr, /停止记录保存失败/);
      assert.match(error.stderr, /未能持久保存/);
      return true;
    });
    assert.deepEqual(fixture.calls(), ['launch', 'disconnect']);
    assert.equal(existsSync(fixture.stopPath), false);
  } finally { fixture.cleanup(); }
});

test('issue27 保留并发写入的首次停止记录', async () => {
  const fixture = makeRiskFixture({ competingStop: true });
  try {
    await assert.rejects(fixture.run('recommend', '--json'), { code: 3 });
    assert.deepEqual(JSON.parse(readFileSync(fixture.stopPath, 'utf8')), {
      version: 1, stoppedAt: '2000-01-01T00:00:00.000Z', command: 'greet',
    });
    assert.deepEqual(fixture.calls(), ['launch', 'disconnect']);
  } finally { fixture.cleanup(); }
});

test('issue27 无法读取记录仍停止', async () => {
  const fixture = makeRiskFixture();
  try {
    mkdirSync(fixture.stopPath);
    await assert.rejects(fixture.run('chatlist', '--json'), { code: 3 });
    const { stdout } = await fixture.run('risk', '--json');
    assert.equal(JSON.parse(stdout).blocked, true);
    assert.deepEqual(fixture.calls(), []);
  } finally { fixture.cleanup(); }
});
