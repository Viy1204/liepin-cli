/**
 * 猎聘聊天消息命令 - 招聘者端
 *
 * 走 LPT 接口 com.liepin.im.b.chat.chat-list（抓包确认）：
 *   body: imUserType=2&imId=<自己imId>&imApp=1&oppositeImId=<对方imId>&maxMessageId=&pageSize=20
 *   resp: data.list[] { msgId, msgTime(ms), msgType, direction, payload(JSON), msgSendImId, ... }
 * 入参是对方 imId（chatlist 返回的 im_id），不是旧的 chatId。
 */

import { Page } from 'puppeteer-core';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt, readLptImId } from '../common/lpt-utils.js';

export interface ChatmsgOptions {
  oppositeImId: string;
  limit?: number;
}

function parsePayload(payload: string): string {
  try {
    const body = JSON.parse(payload || '{}').bodies?.[0];
    if (body?.type === 'txt') return body.msg || '';
    return body?.type ? `[${body.type}]` : '';
  } catch {
    return '';
  }
}

export async function chatmsg(page: Page, options: ChatmsgOptions): Promise<any[]> {
  const { oppositeImId, limit = 50 } = options;

  if (!oppositeImId) {
    throw new Error('对方 imId 不能为空（取 chatlist 结果里的 im_id）');
  }

  await navigateToLpt(page, '/im', 3);

  const imId = await readLptImId(page);
  if (!imId) {
    throw new Error('无法读取自己的 imId，请确保已登录招聘者端');
  }

  const body = `imUserType=2&imId=${encodeURIComponent(imId)}&imApp=1&oppositeImId=${encodeURIComponent(oppositeImId)}&maxMessageId=&pageSize=${Math.min(limit, 100)}`;
  const data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.chat.chat-list`, {
    body,
    clientId: '40342',
  });

  if (data.flag !== 1) {
    throw new Error(`获取聊天消息失败: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const list = data.data?.list || [];
  // 接口按时间倒序返回，翻转成正序（旧→新）方便阅读
  return list.slice().reverse().map((item: any) => {
    const ts = item.msgTime ? new Date(Number(item.msgTime)) : null;
    const timeStr = ts
      ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
      : '';
    return {
      sender: item.msgSendImId === imId ? '我' : '对方',
      content: parsePayload(item.payload),
      time: timeStr,
      type: item.msgType || 'txt',
    };
  });
}

/** 聊天消息命令定义 */
export const chatmsgCommand = {
  name: 'chatmsg',
  description: '查看与某候选人的聊天记录（招聘端）',
  args: [
    { name: 'oppositeImId', type: 'string', required: true, positional: true, help: '对方 imId（chatlist 返回的 im_id）' },
    { name: 'limit', type: 'int', default: 50, help: '返回条数（1-100）' },
  ],
  columns: [
    { header: '发送者', key: 'sender', width: 8 },
    { header: '内容', key: 'content', width: 60 },
    { header: '时间', key: 'time', width: 20 },
    { header: '类型', key: 'type', width: 10 },
  ],
  func: chatmsg,
};
