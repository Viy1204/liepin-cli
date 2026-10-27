import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatmsg, chatmsgCommand } from './chatmsg.js';
import { RiskControlError } from '../common/lpt-utils.js';

const RESOLVE_OPTIONS = { oppositeImId: 'synthetic-im', 'resolve-resume': true };

function resumeCard(resumeInfo: any = {
  resumeId: 'synthetic-card-id', imId: 'synthetic-im', userId: 'synthetic-user',
}) {
  return {
    msgSendImId: 'synthetic-im',
    msgType: 'txt',
    payload: JSON.stringify({
      bodies: [{ type: 'txt', msg: '简历卡片' }],
      ext: { extBody: { bizData: { resumeInfo } } },
    }),
  };
}

function fakePage(list: any[], resolverResponse: any = {
  flag: 1, data: 'synthetic-current-id&ejobId=synthetic-job',
}) {
  const requests: Array<{ url: string; body: string; clientId: string }> = [];
  const page: any = {
    url: () => 'https://lpt.liepin.com/recommend',
    goto: async () => {},
    mainFrame: () => ({ client: { send: async () => {} } }),
    evaluate: async (_fn: any, ...args: any[]) => {
      if (args.length === 0) return 'synthetic-self-im';
      const [url, body, clientId] = args;
      requests.push({ url, body, clientId });
      let data;
      if (url === 'https://api-lpt.liepin.com/api/com.liepin.im.b.chat.chat-list') {
        data = { flag: 1, data: { list } };
      } else if (url === 'https://api-lpt.liepin.com/api/com.liepin.im.b.common.get-resume-id') {
        if (resolverResponse instanceof Error) throw resolverResponse;
        data = resolverResponse;
      } else {
        throw new Error(`未预期的请求: ${url}`);
      }
      return { ok: true, status: 200, text: JSON.stringify(data) };
    },
  };
  return { page, requests };
}

test('chatmsg: 默认仅保留历史 card_resume_id，不增加解析请求，其他消息保持原有输出', async () => {
  const { page, requests } = fakePage([
    resumeCard({ imId: 'synthetic-im', userId: 'synthetic-user' }),
    { msgSendImId: 'synthetic-im', msgType: 'txt', payload: '{invalid' },
    {
      msgSendImId: 'synthetic-self-im',
      msgType: 'txt',
      payload: JSON.stringify({ bodies: [{ type: 'txt', msg: '普通文本' }] }),
    },
    resumeCard(),
  ]);

  const messages = await chatmsg(page, { oppositeImId: 'synthetic-im' });

  assert.deepEqual(messages, [
    { sender: '对方', content: '简历卡片', time: '', type: 'txt', card_resume_id: 'synthetic-card-id' },
    { sender: '我', content: '普通文本', time: '', type: 'txt' },
    { sender: '对方', content: '', time: '', type: 'txt' },
    { sender: '对方', content: '简历卡片', time: '', type: 'txt' },
  ]);
  assert.equal(requests.length, 1);
});

test('chatmsg: 显式解析当前 resume_id，不把历史卡片 ID 当作 resIdEncode', async () => {
  const { page, requests } = fakePage([resumeCard({
    resumeId: 'synthetic-card-id', imId: 'synthetic-im', userId: 'synthetic-user/+=',
  })]);

  const messages = await chatmsg(page, RESOLVE_OPTIONS);

  assert.equal(messages[0].card_resume_id, 'synthetic-card-id');
  assert.equal(messages[0].resume_id, 'synthetic-current-id');
  assert.deepEqual(requests.slice(1), [{
    url: 'https://api-lpt.liepin.com/api/com.liepin.im.b.common.get-resume-id',
    body: 'usercIdEncode=synthetic-user%2F%2B%3D',
    clientId: '40342',
  }]);
});

test('chatmsg: 同人多张卡片只解析一次，保留各自历史 ID', async () => {
  const { page, requests } = fakePage([
    resumeCard(),
    resumeCard({ resumeId: 'synthetic-older-card-id', imId: 'synthetic-im', userId: 'synthetic-user' }),
    resumeCard({ resumeId: 'synthetic-other-card-id', imId: 'synthetic-other-im', userId: 'synthetic-other-user' }),
  ]);

  const messages = await chatmsg(page, RESOLVE_OPTIONS);

  assert.deepEqual(messages.map(message => message.resume_id), [undefined, 'synthetic-current-id', 'synthetic-current-id']);
  assert.deepEqual(messages.map(message => message.card_resume_id), ['synthetic-other-card-id', 'synthetic-older-card-id', 'synthetic-card-id']);
  assert.equal(requests.length, 2);
});

test('chatmsg: 显式解析时没有目标简历卡片明确报错，不发解析请求', async () => {
  const { page, requests } = fakePage([
    resumeCard({ resumeId: 'synthetic-other-card-id', imId: 'synthetic-other-im', userId: 'synthetic-other-user' }),
    { msgSendImId: 'synthetic-im', msgType: 'txt', payload: '{invalid' },
    { msgSendImId: 'synthetic-im', msgType: 'txt', payload: JSON.stringify({ bodies: [{ type: 'txt', msg: '普通文本' }] }) },
  ]);

  await assert.rejects(() => chatmsg(page, RESOLVE_OPTIONS), /没有.*简历卡片/);
  assert.equal(requests.length, 1);
});

test('chatmsg: 缺 userId 明确报错，不回退到历史卡片 ID', async () => {
  const { page, requests } = fakePage([resumeCard({ resumeId: 'synthetic-card-id', imId: 'synthetic-im' })]);

  await assert.rejects(() => chatmsg(page, RESOLVE_OPTIONS), /userId/);
  assert.equal(requests.length, 1);
});

test('chatmsg: 同一会话卡片 userId 不一致时拒绝继续解析', async () => {
  const { page, requests } = fakePage([
    resumeCard({ resumeId: 'synthetic-card-id', imId: 'synthetic-im', userId: 'synthetic-other-user' }),
    resumeCard(),
  ]);

  await assert.rejects(() => chatmsg(page, RESOLVE_OPTIONS), /userId.*不一致/);
  assert.equal(requests.length, 1);
});

test('chatmsg: resolver 空值或非法 data 明确报错', async () => {
  for (const data of ['', '&ejobId=synthetic-job', null, {}]) {
    const { page, requests } = fakePage([resumeCard()], { flag: 1, data });

    await assert.rejects(() => chatmsg(page, RESOLVE_OPTIONS), /解析简历 ID 失败/);
    assert.equal(requests.length, 2);
  }
});

test('chatmsg: resolver 错误 flag 明确报错', async () => {
  const { page, requests } = fakePage([resumeCard()], { flag: 0, msg: 'synthetic resolver rejected' });

  await assert.rejects(() => chatmsg(page, RESOLVE_OPTIONS), /解析简历 ID 失败.*synthetic resolver rejected/);
  assert.equal(requests.length, 2);
});

test('chatmsg: resolver 裸 flag 0 和风控文案按真实 lptFetch 边界抛 RiskControlError', async () => {
  for (const response of [{ flag: 0 }, { flag: 0, msg: '操作频繁，请完成安全验证' }]) {
    const { page, requests } = fakePage([resumeCard()], response);

    await assert.rejects(() => chatmsg(page, RESOLVE_OPTIONS), RiskControlError);
    assert.equal(requests.length, 2);
  }
});

test('chatmsg: resolver 的 RiskControlError 原样传播，不重试或回退', async () => {
  const risk = new RiskControlError('synthetic risk control');
  const { page, requests } = fakePage([resumeCard(), resumeCard()], risk);

  await assert.rejects(() => chatmsg(page, RESOLVE_OPTIONS), error => error === risk);
  assert.equal(requests.length, 2);
});

test('chatmsg: CLI 字符串 true 启用解析，字符串 false 不启用', async () => {
  for (const value of ['true', 'false']) {
    const { page, requests } = fakePage([resumeCard()]);

    const messages = await chatmsg(page, { oppositeImId: 'synthetic-im', 'resolve-resume': value } as any);

    assert.equal(messages[0].resume_id, value === 'true' ? 'synthetic-current-id' : undefined);
    assert.equal(requests.length, value === 'true' ? 2 : 1);
  }
});

test('chatmsg: CLI 解析开关默认关闭，两个简历 ID 列不截断', () => {
  const option = chatmsgCommand.args.find(arg => arg.name === 'resolve-resume');
  assert.equal(option?.type, 'bool');
  assert.equal(option?.default, false);
  for (const key of ['resume_id', 'card_resume_id']) {
    const column = chatmsgCommand.columns.find(col => col.key === key);
    assert.equal(column?.noTruncate, true);
  }
});
