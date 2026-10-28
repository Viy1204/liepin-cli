/**
 * 猎聘「索要手机号 / 索要简历」命令 - 招聘者端（issue #20）
 *
 * HR 的完整闭环是「打招呼 → 索要手机号 → 索要简历」，后两步以前只能人工点网页。
 * 这两个动作没有可直接调用的 BFF 接口：它们是 IM 会话输入框上方那排快捷按钮
 * （`span.im-ui-action-button.action-phone` / `.action-resume`），点击后由前端组合
 * 多个内部调用发出请求卡片。所以这里走 DOM 点击，而不是伪造接口请求。
 *
 * 会话必须已经存在——先 `liepin greet`，再调这两条命令，否则按钮不渲染。
 */

import type { RecruitPage } from '../browser/recruit-page.js';
import {
  LIEPIN_LPT_API,
  lptFetch,
  getResumeInfo,
  openResumeImPanel,
  readLptImId,
} from '../common/lpt-utils.js';
import { AuthExpiredError, RiskControlError, sleepRandom } from '../common/utils.js';
import { parseMessageSource } from './chatmsg.js';

export type RequestKind = 'phone' | 'resume';

export interface RequestOptions {
  resumeId: string;
}

/** 按钮类名带语义后缀，直接作为选择器（issue #20 提供、猎聘招聘者端实测存在） */
const ACTION_SELECTOR: Record<RequestKind, string> = {
  phone: '.im-ui-action-button.action-phone',
  resume: '.im-ui-action-button.action-resume',
};

const ACTION_LABEL: Record<RequestKind, string> = {
  phone: '索要手机号',
  resume: '索要简历',
};

async function readRequestMessages(page: RecruitPage, oppositeImId: string, afterClick = false): Promise<{ imId: string; list: any[] } | null> {
  if (!oppositeImId) return null;
  const imId = await readLptImId(page);
  if (!imId) return null;

  let data;
  try {
    data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.chat.chat-list`, {
      body: `imUserType=2&imId=${encodeURIComponent(imId)}&imApp=1&oppositeImId=${encodeURIComponent(oppositeImId)}&maxMessageId=&pageSize=20`,
      clientId: '40342',
    });
  } catch (error) {
    if (!afterClick || error instanceof AuthExpiredError || error instanceof RiskControlError) throw error;
    return null;
  }
  if (data.flag !== 1 || !Array.isArray(data.data?.list)) {
    if (afterClick) return null;
    throw new Error(`读取聊天记录基线失败: ${data.msg || data.message || '响应缺少消息列表'}`);
  }
  return { imId, list: data.data.list };
}

/**
 * 前端 fe-imb 4.12.8 从 bizData.bizKey 末位解码请求类型（phone=2 / resume=3），
 * 请求消息的 extType 为 206、bizType 为 4/6/7。三处同时满足才算目标请求。
 */
function isTargetRequest(item: any, imId: string, kind: RequestKind): boolean {
  if (!imId || String(item.msgSendImId || '') !== imId) return false;
  const source = parseMessageSource(item.payload || '');
  if (source.source !== 'exchange_request' || !['4', '6', '7'].includes(source.biz_type || '')) return false;
  const key = source.biz_key || '';
  return key.length > 0 && key.endsWith(kind === 'phone' ? '2' : '3');
}

/**
 * 点完按钮后可能弹二次确认框。只在真的出现了带确认字样的按钮时才点，
 * 没有就什么都不做——猜着点弹窗比不点更危险。
 */
async function confirmDialogIfPresent(page: RecruitPage): Promise<boolean> {
  return page.evaluate(() => {
    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const all = (root: ParentNode, sel: string): Element[] => Array.prototype.slice.call(root.querySelectorAll(sel));
    const dialog = all(document, '[role="dialog"], [class*="modal"][class*="im"], .ant-im-modal').find(visible);
    if (!dialog) return false;
    const btn = all(dialog, 'button, [class*="btn"]')
      .filter(visible)
      .find((el) => /^(确定|确认|发送|提交|立即索要|继续)$/.test((el.textContent || '').trim()));
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
}

/** 读按钮当前状态：点完常见的变化是变灰/变成「已索要」，可作为发送成功的旁证 */
async function readActionState(page: RecruitPage, selector: string): Promise<{ text: string; disabled: boolean }> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return { text: '', disabled: false };
    const cls = el.className || '';
    return {
      text: (el.textContent || '').trim(),
      disabled: /disabled|disable|gray|grey/i.test(String(cls)) || el.getAttribute('aria-disabled') === 'true',
    };
  }, selector);
}

async function requestFromCandidate(page: RecruitPage, kind: RequestKind, options: RequestOptions): Promise<any> {
  const { resumeId } = options;
  if (!resumeId) {
    throw new Error('简历 ID（resume_id）不能为空');
  }

  const info = await getResumeInfo(page, resumeId);
  const before = await readRequestMessages(page, info.imId);
  const beforeIds = new Set(before?.list.map((item: any) => String(item.msgId || '')));

  await openResumeImPanel(page, resumeId);

  const selector = ACTION_SELECTOR[kind];
  try {
    await page.waitForSelector(selector, { timeout: 15000 });
  } catch (error) {
    if (error instanceof RiskControlError || error instanceof AuthExpiredError) throw error;
    throw new Error(
      `会话里找不到「${ACTION_LABEL[kind]}」按钮（${selector}）。` +
        '通常是还没跟该候选人建立会话——先跑 liepin greet，或该职位当前不支持这个动作。',
    );
  }

  const stateBefore = await readActionState(page, selector);
  if (stateBefore.disabled) {
    return {
      success: false,
      message: `「${ACTION_LABEL[kind]}」按钮当前不可点（可能已经索要过或权益不足）`,
      name: info.name,
      resume_id: resumeId,
      im_id: info.imId,
      confirmed: false,
    };
  }

  await page.click(selector);
  await sleepRandom(1200, 2000);
  const dialogConfirmed = await confirmDialogIfPresent(page);
  if (dialogConfirmed) {
    await sleepRandom(1200, 2000);
  }

  const after = await readRequestMessages(page, info.imId, true);
  const stateAfter = await readActionState(page, selector);
  // 按钮变灰只是旁证；只认可点击后新出现、由自己发出且类型匹配的请求卡片。
  const confirmed = before !== null && after !== null && after.imId === before.imId && after.list.some(item => {
    const id = String(item?.msgId || '');
    return Boolean(id) && !beforeIds.has(id) && isTargetRequest(item, before.imId, kind);
  });

  return {
    success: true,
    message: confirmed
      ? `已向候选人发出「${ACTION_LABEL[kind]}」请求`
      : `已点击「${ACTION_LABEL[kind]}」，但未能确认请求已送达（请人工核对聊天记录，不要自动重发）`,
    name: info.name,
    resume_id: resumeId,
    im_id: info.imId,
    confirmed,
    dialog_confirmed: dialogConfirmed,
    button_text: stateAfter.text,
  };
}

export async function requestPhone(page: RecruitPage, options: RequestOptions): Promise<any> {
  return requestFromCandidate(page, 'phone', options);
}

export async function requestResume(page: RecruitPage, options: RequestOptions): Promise<any> {
  return requestFromCandidate(page, 'resume', options);
}

const REQUEST_ARGS = [
  {
    name: 'resumeId',
    type: 'string',
    required: true,
    positional: true,
    help: '候选人 resume_id（来自 search / recommend / talent）',
  },
];

const REQUEST_COLUMNS = [
  { header: '结果', key: 'message', width: 60 },
];

/** 索要手机号命令定义 */
export const requestPhoneCommand = {
  name: 'request-phone',
  description: '向候选人索要手机号（需先 greet 建立会话）',
  args: REQUEST_ARGS,
  columns: REQUEST_COLUMNS,
  func: requestPhone,
};

/** 索要简历命令定义 */
export const requestResumeCommand = {
  name: 'request-resume',
  description: '向候选人索要简历（需先 greet 建立会话）',
  args: REQUEST_ARGS,
  columns: REQUEST_COLUMNS,
  func: requestResume,
};
