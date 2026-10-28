import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from './greet.js';
import { AuthExpiredError, PageUnavailableError, RiskControlError } from '../common/utils.js';

const USER_ID = 'a'.repeat(32);
const MESSAGE = '您好，方便聊聊吗？';

function textMessage(msgId: string, text = MESSAGE, sender = 'self-im') {
  return { msgId, msgSendImId: sender, payload: JSON.stringify({ bodies: [{ type: 'txt', msg: text }] }) };
}

function fakePage(options: {
  existingChat?: boolean;
  oppositeImId?: string;
  selfImId?: string;
  before?: any[];
  after?: any[];
  baselineResponse?: any;
  afterOpening?: any[];
  verificationResponse?: any;
  verificationError?: Error;
  privilegeResponse?: any;
  afterSendUrl?: string;
  afterSendError?: PageUnavailableError;
} = {}) {
  const requests: string[] = [];
  const clicks: string[] = [];
  const navigations: string[] = [];
  let sendClicked = false;
  let openedNewChat = false;
  let chatReads = 0;
  const page: any = {
    assertAvailable: () => {
      if (sendClicked && options.afterSendError) throw options.afterSendError;
    },
    url: () => sendClicked && options.afterSendUrl ? options.afterSendUrl : 'https://lpt.liepin.com/recommend',
    goto: async (url: string) => { navigations.push(url); },
    waitForSelector: async () => {},
    click: async (selector: string) => {
      clicks.push(selector);
      if (selector.includes('basic-send-btn')) sendClicked = true;
    },
    evaluate: async (fn: Function, ...args: any[]) => {
      if (args.length === 4) {
        const endpoint = String(args[0]).split('/').at(-1)!;
        requests.push(endpoint);
        let data: any;
        if (endpoint.endsWith('resume-view')) {
          data = {
            flag: 1,
            data: {
              resumeDetailVo: { encodeUsercId: USER_ID, baseInfo: { name: '测试候选人' } },
              imInfoVo: { usercImId: options.oppositeImId ?? 'candidate-im' },
            },
          };
        } else if (endpoint.endsWith('has-chat')) {
          data = { flag: 1, data: options.existingChat ?? true };
        } else if (endpoint.endsWith('get-job-chat-list')) {
          data = { flag: 1, data: { list: [{ ejobId: 'job-1', jobKind: 2 }] } };
        } else if (endpoint.endsWith('check-chat-privlege')) {
          data = options.privilegeResponse ?? { flag: 1, data: { chatCheckResultCode: 'can_chat' } };
        } else if (endpoint.endsWith('to-chat2')) {
          data = { flag: 1, data: {} };
          openedNewChat = true;
        } else if (endpoint.endsWith('chat-list')) {
          chatReads++;
          if (sendClicked && options.verificationError) throw options.verificationError;
          if (sendClicked && options.verificationResponse !== undefined) {
            data = options.verificationResponse;
          } else if (!sendClicked && openedNewChat && chatReads > 1) {
            data = { flag: 1, data: { list: options.afterOpening ?? [] } };
          } else if (!sendClicked && options.baselineResponse !== undefined) {
            data = options.baselineResponse;
          } else {
            data = { flag: 1, data: { list: sendClicked ? (options.after ?? []) : (options.before ?? []) } };
          }
        } else {
          throw new Error(`未预期的接口: ${endpoint}`);
        }
        return { ok: true, status: 200, text: JSON.stringify(data) };
      }
      const source = String(fn);
      if (source.includes('document.cookie')) return options.selfImId ?? 'self-im';
      if (source.includes('execCommand')) return undefined;
      if (source.includes('document.body.innerText')) return true;
      throw new Error(`未预期的页面操作: ${source}`);
    },
  };
  return { page, requests, clicks, navigations };
}

test('greet: user_id 加自定义消息在导航、接口和点击之前拒绝', async () => {
  const { page, requests, clicks, navigations } = fakePage({ existingChat: false });
  await assert.rejects(() => greet(page, { usercId: USER_ID, message: MESSAGE }), /需要传入 resume_id/);
  assert.deepEqual(requests, []);
  assert.deepEqual(clicks, []);
  assert.deepEqual(navigations, []);
});

test('greet: 只有已有会话时明确本次未发送，保留幂等成功', async () => {
  const { page, requests, clicks } = fakePage();
  const result = await greet(page, { usercId: USER_ID });
  assert.equal(result.success, true);
  assert.equal(result.opened_new_chat, false);
  assert.equal(result.confirmed, false);
  assert.match(result.message, /本次未发送/);
  assert.ok(!requests.some(url => url.endsWith('to-chat2')));
  assert.deepEqual(clicks, []);
});

test('greet: 开聊接口成功仍不等于预设招呼已确认发送', async () => {
  const { page, requests } = fakePage({ existingChat: false });
  const result = await greet(page, { usercId: USER_ID });
  assert.equal(result.success, true);
  assert.equal(result.opened_new_chat, true);
  assert.equal(result.confirmed, false);
  assert.match(result.message, /未确认/);
  assert.equal(requests.filter(url => url.endsWith('to-chat2')).length, 1);
});

test('greet: 权限检查失败后不继续开聊', async () => {
  const { page, requests } = fakePage({
    existingChat: false,
    privilegeResponse: { flag: 0, msg: '沟通额度不足' },
  });
  await assert.rejects(() => greet(page, { usercId: USER_ID }), /沟通额度不足/);
  assert.ok(!requests.some(url => url.endsWith('to-chat2')));
});

test('greet: 本次新增的己方完整同文才能确认自定义消息', async () => {
  const { page, clicks } = fakePage({
    before: [textMessage('old')],
    after: [textMessage('new'), textMessage('old')],
  });
  const result = await greet(page, { usercId: 'resume-id', message: MESSAGE });
  assert.equal(result.success, true);
  assert.equal(result.confirmed, true);
  assert.equal(result.opened_new_chat, false);
  assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
});

for (const [label, before, after] of [
  ['历史同文', [textMessage('old')], [textMessage('old')]],
  ['对方新发同文', [], [textMessage('new', MESSAGE, 'candidate-im')]],
  ['己方新发其他内容', [], [textMessage('new', '其他消息')]],
  ['缺少消息ID', [], [textMessage('')]],
  ['损坏的payload', [], [{ msgId: 'new', msgSendImId: 'self-im', payload: '{invalid' }]],
] as const) {
  test(`greet: ${label}不能确认本次自定义消息`, async () => {
    const { page, clicks } = fakePage({ before: [...before], after: [...after] });
    const result = await greet(page, { usercId: 'resume-id', message: MESSAGE });
    assert.equal(result.confirmed, false);
    assert.match(result.message, /未能确认/);
    assert.match(result.message, /不要自动重发/);
    assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
  });
}

test('greet: 首行为空且页面可见相同文本时也不以DOM确认', async () => {
  const { page } = fakePage();
  const result = await greet(page, { usercId: 'resume-id', message: '\n未发送的第二行' });
  assert.equal(result.confirmed, false);
});

for (const [label, options] of [
  ['候选人imId缺失', { oppositeImId: '' }],
  ['自己的imId缺失', { selfImId: '' }],
] as const) {
  test(`greet: ${label}时不把旧消息当成新增`, async () => {
    const { page } = fakePage({ ...options, after: [textMessage('old')] });
    const result = await greet(page, { usercId: 'resume-id', message: MESSAGE });
    assert.equal(result.confirmed, false);
  });
}

for (const [label, baselineResponse] of [
  ['基线业务响应失败', { flag: 0, msg: '临时不可用' }],
  ['基线列表缺失', { flag: 1, data: {} }],
] as const) {
  test(`greet: ${label}时在开聊和发送前报错`, async () => {
    const { page, requests, clicks } = fakePage({ existingChat: false, baselineResponse });
    await assert.rejects(() => greet(page, { usercId: 'resume-id', message: MESSAGE }), /基线/);
    assert.ok(!requests.some(url => url.endsWith('to-chat2')));
    assert.ok(!clicks.some(selector => selector.includes('basic-send-btn')));
  });
}

test('greet: 新开聊时预设招呼与自定义文本相同，不能算自定义消息已确认', async () => {
  const preset = textMessage('preset', MESSAGE);
  const { page, clicks } = fakePage({ existingChat: false, afterOpening: [preset], after: [preset] });
  const result = await greet(page, { usercId: 'resume-id', message: MESSAGE });
  assert.equal(result.confirmed, false);
  assert.match(result.message, /无法区分预设招呼与自定义消息/);
  assert.match(result.message, /不要自动重发/);
  assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
});

test('greet: 预设招呼延迟到自定义发送后才可见时仍不能确认自定义消息', async () => {
  const preset = textMessage('preset-only', MESSAGE);
  const { page, clicks } = fakePage({ existingChat: false, before: [], afterOpening: [], after: [preset] });
  const result = await greet(page, { usercId: 'resume-id', message: MESSAGE });
  assert.equal(result.confirmed, false);
  assert.match(result.message, /无法区分预设招呼与自定义消息/);
  assert.match(result.message, /不要自动重发/);
  assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
});

test('greet: 发送后确认接口普通失败时返回未确认', async () => {
  const { page, clicks } = fakePage({ verificationResponse: { flag: 0, msg: '临时不可用' } });
  const result = await greet(page, { usercId: 'resume-id', message: MESSAGE });
  assert.equal(result.confirmed, false);
  assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
});

for (const [label, options] of [
  ['新开聊', { existingChat: false }],
  ['候选人imId缺失', { oppositeImId: '' }],
  ['自己的imId缺失', { selfImId: '' }],
] as const) {
  test(`greet: ${label}点击后页面清空时停止且不重发`, async () => {
    const { page, clicks } = fakePage({ ...options, afterSendUrl: 'about:blank' });
    await assert.rejects(() => greet(page, { usercId: 'resume-id', message: MESSAGE }), PageUnavailableError);
    assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
  });

  test(`greet: ${label}点击后页面会话失效时原样传播且不重发`, async () => {
    const error = new PageUnavailableError('Session closed');
    const { page, clicks } = fakePage({ ...options, afterSendError: error });
    await assert.rejects(() => greet(page, { usercId: 'resume-id', message: MESSAGE }), value => value === error);
    assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
  });
}

for (const ErrorType of [AuthExpiredError, RiskControlError, PageUnavailableError]) {
  test(`greet: 发送后验证发生${ErrorType.name}时原样传播且不重发`, async () => {
    const error = new ErrorType('验证失败');
    const { page, clicks } = fakePage({ verificationError: error });
    await assert.rejects(() => greet(page, { usercId: 'resume-id', message: MESSAGE }), value => value === error);
    assert.equal(clicks.filter(selector => selector.includes('basic-send-btn')).length, 1);
  });
}
