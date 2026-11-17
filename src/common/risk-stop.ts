import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { RiskControlError } from './utils.js';

export type RiskStopRecord = {
  version: 1;
  stoppedAt: string;
  command: string;
};

type RiskStopStatus =
  | { blocked: false }
  | ({ blocked: true } & RiskStopRecord)
  | { blocked: true; reason: string };

export const RISK_STOP_HINT =
  '请停止自动化，不要自动重试、刷新或重登。使用 `liepin risk --json` 查看本地停止状态；' +
  '人工核验并确认允许恢复后，才可用 `liepin risk --clear` 清除本地停止记录。' +
  '清除仅是本地确认，不代表猎聘已解除账号限制。';

export function readRiskStop(): RiskStopStatus {
  let content: string;
  try {
    content = readFileSync(join(config.configDir, 'risk-stop.json'), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { blocked: false };
    return { blocked: true, reason: `无法读取本地停止记录（${code ?? '未知读取错误'}），按停止处理。` };
  }

  try {
    const record = JSON.parse(content);
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.version !== 1 ||
      typeof record.command !== 'string' || !record.command.trim() ||
      typeof record.stoppedAt !== 'string' || !Number.isFinite(Date.parse(record.stoppedAt)) ||
      new Date(record.stoppedAt).toISOString() !== record.stoppedAt) {
      return { blocked: true, reason: '本地停止记录格式不符，按停止处理。' };
    }
    return { blocked: true, version: 1, stoppedAt: record.stoppedAt, command: record.command };
  } catch {
    return { blocked: true, reason: '本地停止记录损坏，按停止处理。' };
  }
}

export function recordRiskStop(command: string): void {
  const record: RiskStopRecord = { version: 1, stoppedAt: new Date().toISOString(), command };
  mkdirSync(config.configDir, { recursive: true });
  try {
    writeFileSync(join(config.configDir, 'risk-stop.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export function assertRiskStopAllowed(): void {
  const status = readRiskStop();
  if (status.blocked) {
    throw new RiskControlError(`自动化已被本地停止记录阻止。${'reason' in status ? status.reason : ''}${RISK_STOP_HINT}`);
  }
}

export function clearRiskStop(): void {
  try {
    unlinkSync(join(config.configDir, 'risk-stop.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
