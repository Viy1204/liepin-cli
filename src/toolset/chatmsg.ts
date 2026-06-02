/**
 * 猎聘聊天消息命令
 */

import { Page } from 'puppeteer-core';
import {
  LIEPIN_IM_API,
  navigateTo, liepinFetch, sleepRandom,
} from '../common/utils.js';

export interface ChatmsgOptions {
  chatId: string;
  limit?: number;
}

export async function chatmsg(page: Page, options: ChatmsgOptions): Promise<any[]> {
  const { chatId, limit = 50 } = options;

  if (!chatId) {
    throw new Error('聊天 ID 不能为空');
  }

  // 导航到聊天页面
  await navigateTo(page, `https://www.liepin.com/chat/${chatId}`);

  // 等待页面加载
  await sleepRandom(1000, 2000);

  // 获取聊天消息
  const response = await liepinFetch(page, `${LIEPIN_IM_API}/api/im/chat-messages`, {
    method: 'POST',
    body: JSON.stringify({
      chatId,
      pageSize: Math.min(limit, 100),
    }),
  });

  // 处理响应
  if (!response || !response.data || !response.data.list) {
    throw new Error('获取聊天消息失败：' + (response?.message || '未知错误'));
  }

  // 映射结果
  return response.data.list.map((item: any) => ({
    sender: item.sender || '',
    content: item.content || '',
    time: item.time || '',
    type: item.type || 'text',
  }));
}

/** 聊天消息命令定义 */
export const chatmsgCommand = {
  name: 'chatmsg',
  description: '查看聊天消息',
  args: [
    { name: 'chatId', type: 'string', required: true, positional: true, help: '聊天 ID' },
    { name: 'limit', type: 'int', default: 50, help: '返回条数（1-100）' },
  ],
  columns: [
    { header: '发送者', key: 'sender', width: 15 },
    { header: '内容', key: 'content', width: 60 },
    { header: '时间', key: 'time', width: 20 },
    { header: '类型', key: 'type', width: 10 },
  ],
  func: chatmsg,
};
