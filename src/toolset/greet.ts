/**
 * 猎聘打招呼命令 - 招聘者端
 *
 * 走 LPT 接口 com.liepin.im.b.chat.to-chat2（抓包确认）：
 *   body: usercIdEncode=<候选人 user_id>&ejobId=<职位 id>&imSign=&source=&ext=%7B%7D
 *   resp: { flag:1, data:{} }
 * 发起沟通即「一键打招呼」，未沟通过时会使用职位预设招呼语。
 *
 * 入参兼容 search 返回的 resume_id 或 user_id。传 message 时，会在建立会话后
 * 打开 IM 面板补发自定义文本。
 */

import { Page } from 'puppeteer-core';
import { LIEPIN_LPT_API, lptFetch, navigateToLpt, readLptImId } from '../common/lpt-utils.js';
import { sleepRandom } from '../common/utils.js';

export interface GreetOptions {
  usercId: string;
  ejobId?: string;
  jobId?: string;
  message?: string;
}

interface ResumeInfo {
  resumeId: string;
  usercId: string;
  imId: string;
  name: string;
}

interface ChatJob {
  ejobId?: number | string;
  jobKind?: number | string;
  jobTitle?: string;
}

function looksLikeUserId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

async function getResumeInfo(page: Page, resumeId: string): Promise<ResumeInfo> {
  const form = new URLSearchParams();
  form.set('pageParamVo', JSON.stringify({
    resIdEncode: resumeId,
    sfrom: 'R_SEARCH_CONDITION',
    applyId: '',
  }));

  const data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.rresume.usere.pc.resume-view`, {
    body: form.toString(),
  });

  if (data.flag !== 1) {
    throw new Error(`获取简历失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  const vo = data.data?.resumeDetailVo;
  if (!vo?.encodeUsercId) {
    throw new Error('获取简历失败: 响应缺少 encodeUsercId');
  }

  return {
    resumeId,
    usercId: String(vo.encodeUsercId),
    imId: String(vo.imId || ''),
    name: vo.baseInfo?.name || '',
  };
}

async function getChatJobs(page: Page): Promise<ChatJob[]> {
  const data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.chat.get-job-chat-list`, {
    body: 'curPage=0&pageSize=10&_keyword=',
    clientId: '40342',
  });

  if (data.flag !== 1) {
    throw new Error(`获取开聊职位失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  return data.data?.list || [];
}

async function hasChat(page: Page, usercId: string): Promise<boolean> {
  const data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.chat.has-chat`, {
    body: `encodeOppositeUserId=${encodeURIComponent(usercId)}`,
    clientId: '40342',
  });

  if (data.flag !== 1) {
    throw new Error(`检查会话失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  return data.data === true;
}

async function pickChatJob(page: Page, ejobId: string): Promise<ChatJob> {
  const jobs = await getChatJobs(page);
  const selected = ejobId
    ? jobs.find(job => String(job.ejobId) === String(ejobId))
    : jobs[0];

  if (!selected?.ejobId) {
    throw new Error('开聊失败：没有可用职位，请传入 --ejobId 或先发布职位');
  }

  return selected;
}

async function verifyMessageSent(page: Page, oppositeImId: string, message: string): Promise<boolean> {
  const imId = await readLptImId(page);
  if (!imId || !oppositeImId) return false;

  const body = `imUserType=2&imId=${encodeURIComponent(imId)}&imApp=1&oppositeImId=${encodeURIComponent(oppositeImId)}&maxMessageId=&pageSize=10`;
  const data = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.chat.chat-list`, {
    body,
    clientId: '40342',
  });
  if (data.flag !== 1) return false;

  const list = data.data?.list || [];
  return list.some((item: any) => {
    if (item.msgSendImId !== imId) return false;
    try {
      const bodyItem = JSON.parse(item.payload || '{}').bodies?.[0];
      return bodyItem?.type === 'txt' && String(bodyItem.msg || '') === message;
    } catch {
      return false;
    }
  });
}

async function sendMessageInIm(page: Page, resumeId: string, oppositeImId: string, message: string): Promise<void> {
  await page.goto(`https://lpt.liepin.com/resume/detail?resIdEncode=${encodeURIComponent(resumeId)}&sfrom=R_SEARCH_CONDITION`, {
    waitUntil: 'networkidle2',
  });
  await page.waitForSelector('.xpath-open-im-btn', { timeout: 20000 });
  await page.click('.xpath-open-im-btn');
  await page.waitForSelector('.im-ui-textarea', { timeout: 20000 });

  // React 受控组件：keyboard.type 中文输入极慢且易超时，execCommand 才能触发 React 状态更新
  await page.evaluate((msg: string) => {
    const el = document.querySelector('.im-ui-textarea') as HTMLTextAreaElement;
    el.focus();
    if (typeof el.select === 'function') el.select();
    document.execCommand('insertText', false, msg);
  }, message);

  // 输入生效后发送按钮才会从 disabled 变为可用
  await page.waitForSelector('.im-ui-basic-send-btn:not([disabled])', { timeout: 5000 });
  await page.click('.im-ui-basic-send-btn:not([disabled])');
  await sleepRandom(1500, 2500);

  const sent = await verifyMessageSent(page, oppositeImId, message);
  if (!sent) {
    // imId 缺失或 API 未及时落库时退回页面文本兜底检查
    const visible = await page.evaluate(
      (text: string) => document.body.innerText.includes(text),
      message.split('\n')[0],
    );
    if (!visible) {
      throw new Error('消息发送后未确认成功（聊天记录与页面中均未找到该消息）');
    }
  }
}

export async function greet(page: Page, options: GreetOptions): Promise<any> {
  const { usercId: targetId, message = '' } = options;
  const ejobId = options.ejobId || options.jobId || '';

  if (!targetId) {
    throw new Error('候选人 ID 不能为空（可传 search 返回的 resume_id 或 user_id）');
  }

  // 落到 LPT 同源页面即可（后续全走 api-lpt 接口 / 自身 resume/detail 导航）；旧 /im 路由已 404，改用 /recommend
  await navigateToLpt(page, '/recommend', 2);
  const resume = looksLikeUserId(targetId)
    ? { resumeId: '', usercId: targetId, imId: '', name: '' }
    : await getResumeInfo(page, targetId);

  const alreadyHasChat = await hasChat(page, resume.usercId);
  let selectedJob: ChatJob | null = null;

  if (!alreadyHasChat) {
    selectedJob = await pickChatJob(page, ejobId);
    const priv = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.imbusiness.bpc.check-chat-privlege`, {
      body: `oppositeUserId=${encodeURIComponent(resume.usercId)}&enumLpScene=b_others&jobId=${encodeURIComponent(String(selectedJob.ejobId))}&jobkind=${encodeURIComponent(String(selectedJob.jobKind || 2))}`,
      clientId: '40342',
    });
    const code = priv?.data?.chatCheckResultCode;
    if (priv.flag === 1 && code && code !== 'can_chat') {
      throw new Error(`无法打招呼（chatCheckResultCode=${code}）：该职位可能已无沟通次数或候选人不可沟通`);
    }

    const body = `usercIdEncode=${encodeURIComponent(resume.usercId)}&ejobId=${encodeURIComponent(String(selectedJob.ejobId))}&imSign=&source=R_SEARCH_CONDITION&ext=%7B%7D`;
    const res = await lptFetch(page, `${LIEPIN_LPT_API}/api/com.liepin.im.b.chat.to-chat2`, {
      body,
      clientId: '40342',
    });

    if (res.flag !== 1) {
      throw new Error('打招呼失败：' + (res?.msg || res?.message || JSON.stringify(res).slice(0, 200)));
    }
  }

  if (message) {
    if (!resume.resumeId) {
      throw new Error('发送自定义消息需要传入 resume_id；仅传 user_id 时只能发起默认沟通');
    }
    await sendMessageInIm(page, resume.resumeId, resume.imId, message);
  }

  return {
    success: true,
    message: message ? '已发起沟通并发送自定义消息' : '已发起沟通（使用职位预设招呼语）',
    usercId: resume.usercId,
    resume_id: resume.resumeId,
    im_id: resume.imId,
    opened_new_chat: !alreadyHasChat,
    ejobId: String(selectedJob?.ejobId || ejobId),
    job_title: selectedJob?.jobTitle || '',
  };
}

/** 打招呼命令定义 */
export const greetCommand = {
  name: 'greet',
  description: '向候选人打招呼（支持 resume_id + 自定义消息）',
  args: [
    { name: 'usercId', type: 'string', required: true, positional: true, help: '候选人 resume_id 或 user_id（来自 search / recommend）' },
    { name: 'ejobId', type: 'string', default: '', help: '关联职位 ID（建议传，用于权限校验与归属）' },
    { name: 'jobId', type: 'string', default: '', help: '关联职位 ID（ejobId 别名）' },
    { name: 'message', type: 'string', default: '', help: '自定义消息（传 resume_id 时可用）' },
  ],
  columns: [
    { header: '结果', key: 'message', width: 60 },
  ],
  func: greet,
};
