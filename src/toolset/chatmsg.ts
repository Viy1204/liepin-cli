/**
 * 猎聘聊天消息命令 - 招聘者端
 *
 * 走 LPT 接口 com.liepin.im.b.chat.chat-list（抓包确认）：
 *   body: imUserType=2&imId=<自己imId>&imApp=1&oppositeImId=<对方imId>&maxMessageId=&pageSize=20
 *   resp: data.list[] { msgId, msgTime(ms), msgType, direction, payload(JSON), msgSendImId, ... }
 * 入参是对方 imId（chatlist 返回的 im_id），不是旧的 chatId。
 */

import type { RecruitPage } from '../browser/recruit-page.js';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt, readLptImId } from '../common/lpt-utils.js';

export interface ChatmsgOptions {
  oppositeImId: string;
  limit?: number;
  'resolve-resume'?: boolean | string;
}

/** 中国大陆手机号：候选人同意索要后，号码就落在卡片消息的 payload 里 */
const PHONE_PATTERN = /1[3-9]\d{9}/;

/**
 * 卡片类消息（如候选人同意「索要手机号」后回的那张卡）原本只输出 `[手机号]`，
 * 号码明文其实就在 payload 里。直接抽出来，省掉「还得人工去网页看一眼」这一步（issue #20）。
 */
export function parsePayload(payload: string): string {
  try {
    const body = JSON.parse(payload || '{}').bodies?.[0];
    if (body?.type === 'txt') return body.msg || '';
    const label = body?.type ? `[${body.type}]` : '';
    const phone = PHONE_PATTERN.exec(payload || '');
    if (phone) return label ? `${label} ${phone[0]}` : phone[0];
    return label;
  } catch {
    return '';
  }
}

export async function chatmsg(page: RecruitPage, options: ChatmsgOptions): Promise<any[]> {
  const { oppositeImId, limit = 50 } = options;
  const resolveResume = options['resolve-resume'] === true || options['resolve-resume'] === 'true';

  if (!oppositeImId) {
    throw new Error('对方 imId 不能为空（取 chatlist 结果里的 im_id）');
  }

  // 落到 LPT 同源页面拿 cookie/imId（消息走 api-lpt 接口）；旧 /im 路由已 404，改用 /recommend
  await navigateToLpt(page, '/recommend', 3);

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
  const cards = list.map((item: any) => {
    try {
      return JSON.parse(item.payload || '{}')?.ext?.extBody?.bizData?.resumeInfo;
    } catch {
      return undefined;
    }
  });
  let currentResumeId = '';
  if (resolveResume) {
    const targetCards = cards.filter((info: any) => info?.imId === oppositeImId);
    if (targetCards.length === 0) {
      throw new Error(`当前 ${list.length} 条聊天记录中没有属于该候选人的简历卡片，无法解析 resume_id`);
    }
    const userIds = new Set<string>();
    for (const info of targetCards) {
      if (typeof info.userId !== 'string' || !info.userId.trim()) {
        throw new Error('简历卡片缺少可解析的 userId，无法获取当前 resume_id');
      }
      userIds.add(info.userId.trim());
    }
    if (userIds.size !== 1) {
      throw new Error('同一会话的简历卡片 userId 不一致，无法解析 resume_id');
    }

    const userId = [...userIds][0];
    const resolved = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.common.get-resume-id`, {
      body: `usercIdEncode=${encodeURIComponent(userId)}`,
      clientId: '40342',
    });
    if (resolved.flag !== 1) {
      throw new Error(`解析简历 ID 失败: ${resolved.msg || resolved.message || JSON.stringify(resolved).slice(0, 200)}`);
    }
    currentResumeId = typeof resolved.data === 'string' ? resolved.data.split('&')[0].trim() : '';
    if (!currentResumeId) {
      throw new Error('解析简历 ID 失败：接口 data 中没有非空的简历 ID');
    }
  }

  // 接口按时间倒序返回，翻转成正序（旧→新）方便阅读
  return list.map((item: any, index: number) => {
    const card = cards[index];
    const ts = item.msgTime ? new Date(Number(item.msgTime)) : null;
    const timeStr = ts
      ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
      : '';
    return {
      sender: item.msgSendImId === imId ? '我' : '对方',
      content: parsePayload(item.payload),
      time: timeStr,
      type: item.msgType || 'txt',
      ...(card?.resumeId ? { card_resume_id: card.resumeId } : {}),
      ...(currentResumeId && card?.imId === oppositeImId ? { resume_id: currentResumeId } : {}),
    };
  }).reverse();
}

/** 聊天消息命令定义 */
export const chatmsgCommand = {
  name: 'chatmsg',
  description: '查看与某候选人的聊天记录（招聘端）',
  args: [
    { name: 'oppositeImId', type: 'string', required: true, positional: true, help: '对方 imId（chatlist 返回的 im_id）' },
    { name: 'limit', type: 'int', default: 50, help: '返回条数（1-100）' },
    { name: 'resolve-resume', type: 'bool', default: false, help: '从目标简历卡片解析当前 resume_id（增加一次只读请求）' },
  ],
  columns: [
    { header: '发送者', key: 'sender', width: 8 },
    { header: '内容', key: 'content', width: 60 },
    { header: '时间', key: 'time', width: 20 },
    { header: '类型', key: 'type', width: 10 },
    { header: '简历ID', key: 'resume_id', width: 23, noTruncate: true },
    { header: '卡片历史ID', key: 'card_resume_id', width: 23, noTruncate: true },
  ],
  func: chatmsg,
};
