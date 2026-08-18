/**
 * CLI 占用锁：告诉 DSH 面板「此刻有命令正在操作同一只浏览器」。
 *
 * 面板的有头/无头切换要关掉浏览器重开，会打断正在跑的命令，所以它需要知道现在能不能切。
 * 而两边之间原本没有任何共享状态——各自连同一个调试端口，互相看不见。
 *
 * 约定与 `RECRUIT_BROWSER_HIDDEN` 同级：三方（recruiting-copilot 面板 / boss-cli /
 * liepin-cli）共用 `~/.recruit-browser/<source>.busy.json`，内容 `{pid, command, startedAt}`。
 *
 * **光有文件不算数**：进程被 kill 会留下僵尸锁，所以读锁的一方必须校验 pid 还活着。
 * 这样我们不需要保证清理逻辑一定跑到，也不会把面板永久锁死。
 */
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SOURCE = 'liepin';

function lockFile(): string {
  return join(homedir(), '.recruit-browser', `${SOURCE}.busy.json`);
}

/** 命令开始时写锁。任何失败都只是让面板失去这条信息，不该影响命令本身。 */
export function acquireBusyLock(command: string): void {
  try {
    mkdirSync(join(homedir(), '.recruit-browser'), { recursive: true });
    writeFileSync(
      lockFile(),
      JSON.stringify({ pid: process.pid, command: `liepin ${command}`, startedAt: Date.now() }),
    );
  } catch {
    /* 锁只是给面板看的提示，写不进去不影响命令 */
  }
}

export function releaseBusyLock(): void {
  try {
    unlinkSync(lockFile());
  } catch {
    /* 已经被清掉（比如面板判定 pid 已死），忽略 */
  }
}
