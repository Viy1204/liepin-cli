import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { copySkill, installSkill } from './skill.js';

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `liepin-${prefix}-`));
}

async function withSkillTarget<T>(targetDir: string, fn: () => Promise<T>): Promise<T> {
  const originalTargetDir = process.env.LIEPIN_SKILL_TARGET_DIR;
  process.env.LIEPIN_SKILL_TARGET_DIR = targetDir;
  try {
    return await fn();
  } finally {
    if (originalTargetDir === undefined) {
      delete process.env.LIEPIN_SKILL_TARGET_DIR;
    } else {
      process.env.LIEPIN_SKILL_TARGET_DIR = originalTargetDir;
    }
  }
}

test('copySkill: 复制所有文件到目标目录', async () => {
  const src = makeTempDir('skill-src');
  const dst = makeTempDir('skill-dst');
  try {
    writeFileSync(join(src, 'SKILL.md'), '# test');
    writeFileSync(join(src, 'extra.txt'), 'extra');
    writeFileSync(join(src, 'data.json'), '{}');

    const result = await copySkill(src, dst);
    assert.equal(result.files_copied, 3);
    assert.equal(result.source, src);
    assert.equal(result.target, dst);
    assert.ok(existsSync(join(dst, 'SKILL.md')));
    assert.ok(existsSync(join(dst, 'extra.txt')));
    assert.ok(existsSync(join(dst, 'data.json')));
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  }
});

test('copySkill: 源目录不存在抛错', async () => {
  const dst = makeTempDir('skill-dst');
  try {
    await assert.rejects(
      () => copySkill('/nonexistent/path/xxx', dst),
      /源目录不存在/,
    );
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test('copySkill: 目标目录不存在自动创建', async () => {
  const src = makeTempDir('skill-src');
  const dst = join(makeTempDir('skill-dst-parent'), 'nested', 'skill');
  try {
    writeFileSync(join(src, 'SKILL.md'), '# test');
    const result = await copySkill(src, dst);
    assert.equal(result.files_copied, 1);
    assert.ok(existsSync(dst), '目标目录应该被自动创建');
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(join(dst, '..', '..'), { recursive: true, force: true });
  }
});

test('copySkill: 子目录不递归（只复制顶层文件）', async () => {
  const src = makeTempDir('skill-src');
  const dst = makeTempDir('skill-dst');
  try {
    writeFileSync(join(src, 'top.md'), 'top');
    mkdirSync(join(src, 'sub'));
    writeFileSync(join(src, 'sub', 'nested.md'), 'nested');
    const result = await copySkill(src, dst);
    assert.equal(result.files_copied, 1, '应该只复制顶层文件 top.md');
    assert.ok(existsSync(join(dst, 'top.md')));
    assert.ok(!existsSync(join(dst, 'sub')), '子目录不应被复制');
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  }
});

test('installSkill: 默认 action=install 复制源 skill 目录', async () => {
  const target = makeTempDir('skill-install');
  try {
    await withSkillTarget(target, async () => {
      const result = await installSkill(null, {});
      assert.equal(result.success, true);
      assert.ok(result.files_copied >= 1, '源 skill 目录至少包含 SKILL.md');
      assert.ok(result.source.endsWith('skills/liepin-cli'));
      assert.equal(result.target, target);
      assert.ok(existsSync(join(target, 'SKILL.md')));
      assert.match(result.message, /Skill 已安装到/);
    });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('installSkill: 显式 action=install 等同默认', async () => {
  const target = makeTempDir('skill-install');
  try {
    await withSkillTarget(target, async () => {
      const result = await installSkill(null, { action: 'install' });
      assert.equal(result.success, true);
      assert.equal(result.target, target);
    });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('installSkill: 不支持的子命令抛错', async () => {
  await assert.rejects(
    () => installSkill(null, { action: 'uninstall' }),
    /不支持的子命令/,
  );
});
