import { clearRiskStop, readRiskStop, RISK_STOP_HINT } from '../common/risk-stop.js';

export const riskCommand = {
  name: 'risk',
  description: '查看或显式清除本地自动化停止记录（不访问猎聘）',
  requiresPage: false,
  args: [
    { name: 'clear', type: 'bool', default: false, help: '人工确认后清除本地停止记录，不代表平台已解除限制' },
  ],
  columns: [],
  func: async (_page: unknown, options: { clear?: boolean | string }) => {
    if (options.clear === true) clearRiskStop();
    const status = readRiskStop();
    return {
      ...status,
      message: status.blocked ? RISK_STOP_HINT : '当前没有本地停止记录。这不代表猎聘已解除账号限制，也不会自动重试此前操作。',
    };
  },
};
