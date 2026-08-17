/**
 * 关掉常驻的猎聘浏览器。
 *
 * 浏览器跨命令常驻（命令结束只断 CDP），所以需要一个显式的退出口——跑完招聘想释放
 * 内存时用它。登录态在 user-data-dir 里，关掉不会丢，下条命令会自动重新拉起并仍登录。
 */

import { closeRemoteBrowser, probeRemoteHeadless, REMOTE_DEBUGGING_PORT } from '../browser/cdp_browser.js';

export async function quit(): Promise<any> {
  const headless = await probeRemoteHeadless();
  if (headless === null) {
    return {
      success: true,
      result: `没有在跑的猎聘浏览器（端口 ${REMOTE_DEBUGGING_PORT} 无响应），无需关闭`,
    };
  }

  const closed = await closeRemoteBrowser();
  return {
    success: closed,
    result: closed
      ? `已关闭猎聘浏览器（${headless ? '无头' : '有头'}，端口 ${REMOTE_DEBUGGING_PORT}）。登录态已保留，下条命令会自动重新拉起。`
      : `关闭失败：端口 ${REMOTE_DEBUGGING_PORT} 上的浏览器没有响应关闭请求，可手动结束该 Chrome 主进程。`,
  };
}

/** quit 命令定义 */
export const quitCommand = {
  name: 'quit',
  description: '关掉常驻的猎聘浏览器（登录态保留）',
  args: [],
  columns: [
    { header: '结果', key: 'result', width: 80 },
  ],
  requiresPage: false,
  func: quit,
};
