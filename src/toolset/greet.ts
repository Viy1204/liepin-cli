/**
 * 猎聘打招呼命令 - 招聘者端
 *
 * 走 LPT 接口 com.liepin.im.b.chat.to-chat2（抓包确认）：
 *   body: usercIdEncode=<候选人 user_id>&ejobId=<职位 id>&imSign=&source=&ext=%7B%7D
 *   resp: { flag:1, data:{} }
 * 发起沟通即「一键打招呼」，使用职位预设招呼语，不支持自定义消息文本
 * （如需个性化文案，建立会话后在 IM 中另行发送）。
 *
 * 入参是候选人 user_id（search / recommend 返回的 user_id，即 enusercId），
 * 不是旧实现里的 C 端 talentId。可选先调 check-chat-privlege 校验沟通权限。
 */

import { Page } from 'puppeteer-core';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt } from '../common/lpt-utils.js';

export interface GreetOptions {
  usercId: string;
  ejobId?: string;
}

export async function greet(page: Page, options: GreetOptions): Promise<any> {
  const { usercId, ejobId = '' } = options;

  if (!usercId) {
    throw new Error('候选人 user_id 不能为空（取 search / recommend 结果里的 user_id）');
  }

  await navigateToLpt(page, '/im', 2);

  // 1) 校验沟通权限（传了 ejobId 才校验，能提前拦截不可沟通 / 需付费的情况）
  if (ejobId) {
    const priv = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.imbusiness.bpc.check-chat-privlege`, {
      body: `oppositeUserId=${encodeURIComponent(usercId)}&enumLpScene=b_others&jobId=${encodeURIComponent(ejobId)}&jobkind=2`,
      clientId: '40342',
    });
    const code = priv?.data?.chatCheckResultCode;
    if (priv.flag === 1 && code && code !== 'can_chat') {
      throw new Error(`无法打招呼（chatCheckResultCode=${code}）：该职位可能已无沟通次数或候选人不可沟通`);
    }
  }

  // 2) 发起沟通（一键打招呼，使用职位预设招呼语）
  const body = `usercIdEncode=${encodeURIComponent(usercId)}&ejobId=${encodeURIComponent(ejobId)}&imSign=&source=&ext=%7B%7D`;
  const res = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.chat.to-chat2`, {
    body,
    clientId: '40342',
  });

  if (res.flag !== 1) {
    throw new Error('打招呼失败：' + (res?.msg || res?.message || JSON.stringify(res).slice(0, 200)));
  }

  return {
    success: true,
    message: '已发起沟通（使用职位预设招呼语；如需自定义文案请在 IM 会话中另发）',
    usercId,
    ejobId,
  };
}

/** 打招呼命令定义 */
export const greetCommand = {
  name: 'greet',
  description: '向候选人打招呼（一键沟通，使用职位预设招呼语）',
  args: [
    { name: 'usercId', type: 'string', required: true, positional: true, help: '候选人 user_id（search / recommend 返回的 user_id）' },
    { name: 'ejobId', type: 'string', default: '', help: '关联职位 ID（建议传，用于权限校验与归属）' },
  ],
  columns: [
    { header: '结果', key: 'message', width: 60 },
  ],
  func: greet,
};
