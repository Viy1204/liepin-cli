/**
 * 猎聘聊天列表命令 - 招聘者端
 */

import { Page } from 'puppeteer-core';
import { LIEPIN_LPT_API, navigateToLpt, lptFetch, readLptImId } from '../common/lpt-utils.js';

export interface ChatlistOptions {
  limit?: number;
}

export async function chatlist(page: Page, options: ChatlistOptions): Promise<any[]> {
  const { limit = 30 } = options;

  // 导航到 LPT 聊天页面
  await navigateToLpt(page, '/im', 3);

  // 读取 imId
  const imId = await readLptImId(page);
  if (!imId) {
    throw new Error('无法读取 imId，请确保已登录招聘者端');
  }

  // 获取聊天列表
  const body = `imUserType=2&imId=${encodeURIComponent(imId)}&imApp=1&pageSize=${limit}&curPage=0`;
  const data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.contact.get-contact-list`, { 
    body, 
    clientId: '40342' 
  });

  if (data.flag !== 1) {
    throw new Error(`获取聊天列表失败: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const contacts = data.data?.list || [];
  if (contacts.length === 0) {
    return [];
  }

  return contacts.slice(0, limit).map((c: any) => {
    // 解析最后消息
    let latestMsg = '';
    try {
      const payload = JSON.parse(c.lastPayload || '{}');
      const body = payload.bodies?.[0];
      if (body?.type === 'txt') latestMsg = body.msg || '';
    } catch (_) {}

    // 格式化时间
    const ts = c.latestMsgTime ? new Date(c.latestMsgTime) : null;
    const timeStr = ts ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}` : '';

    return {
      name: c.name || '',
      sex: c.sex || '',
      age: String(c.age || ''),
      experience: c.workage ? `${c.workage}年` : '',
      degree: c.edulevel || '',
      city: c.dq || '',
      current_company: c.company || '',
      current_title: c.title || '',
      want_title: '',
      latest_msg: latestMsg,
      latest_msg_time: timeStr,
      unread_count: String(c.unreadCount || 0),
      direction: c.direction || '',
      resume_url: c.resumeUrl || '',
      user_id: String(c.userId || ''),
      im_id: String(c.imId || ''),
    };
  });
}

/** 聊天列表命令定义 */
export const chatlistCommand = {
  name: 'chatlist',
  description: '查看聊天列表（招聘端）',
  args: [
    { name: 'limit', type: 'int', default: 30, help: '返回条数（1-100）' },
  ],
  columns: [
    { header: '姓名', key: 'name', width: 10 },
    { header: '职位', key: 'current_title', width: 20 },
    { header: '公司', key: 'current_company', width: 15 },
    { header: '最后消息', key: 'latest_msg', width: 30 },
    { header: '时间', key: 'latest_msg_time', width: 15 },
    { header: '未读', key: 'unread_count', width: 5 },
  ],
  func: chatlist,
};
