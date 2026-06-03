/**
 * Skill 管理命令
 * 把 skills/liepin-cli/SKILL.md 安装到 ~/.claude/skills/，让 Claude Code 自动发现
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILL_NAME = 'liepin-cli';
const SKILL_SOURCE_DIR = join(__dirname, '..', '..', 'skills', 'liepin-cli');

function getTargetDir(): string {
  if (process.env.LIEPIN_SKILL_TARGET_DIR) {
    return process.env.LIEPIN_SKILL_TARGET_DIR;
  }
  return join(homedir(), '.claude', 'skills', SKILL_NAME);
}

export interface SkillOptions {
  action?: string;
}

export interface CopySkillResult {
  source: string;
  target: string;
  files_copied: number;
}

export async function copySkill(sourceDir: string, targetDir: string): Promise<CopySkillResult> {
  if (!existsSync(sourceDir)) {
    throw new Error(`Skill 源目录不存在: ${sourceDir}`);
  }

  mkdirSync(targetDir, { recursive: true });

  let copied = 0;
  for (const file of readdirSync(sourceDir)) {
    const src = join(sourceDir, file);
    const dst = join(targetDir, file);
    if (statSync(src).isFile()) {
      copyFileSync(src, dst);
      copied++;
    }
  }

  return {
    source: sourceDir,
    target: targetDir,
    files_copied: copied,
  };
}

export async function installSkill(_page: unknown, options: SkillOptions = {}): Promise<any> {
  const action = options.action || 'install';

  if (action !== 'install') {
    throw new Error(`不支持的子命令: ${action}。当前仅支持: install`);
  }

  const result = await copySkill(SKILL_SOURCE_DIR, getTargetDir());
  return {
    success: true,
    message: `Skill 已安装到 ${result.target}`,
    ...result,
  };
}

export const skillCommand = {
  name: 'skill',
  description: '管理 skill（安装到 Claude Code）',
  args: [
    { name: 'action', type: 'string', default: 'install', help: '操作：install' },
  ],
  columns: [
    { header: '结果', key: 'result', width: 80 },
  ],
  requiresPage: false,
  func: installSkill,
};
