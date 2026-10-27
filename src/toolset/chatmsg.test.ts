import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatmsg, chatmsgCommand, parseMessageSource } from './chatmsg.js';
import { RiskControlError } from '../common/lpt-utils.js';

const WECHAT_REQUEST = '为了方便联系，可以交换微信号吗？';
const RESOLVE_OPTIONS = { oppositeImId: 'synthetic-im', 'resolve-resume': true };

function textPayload(ext?: unknown) {
  return JSON.stringify({ bodies: [{ type: 'txt', msg: WECHAT_REQUEST }], ext });
}

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

test('来源字段按字符串返回，兼容数字和字符串协议码', () => {
  for (const [extType, bizType, bizKey] of [[206, 6, 10001], ['206', '6', '10001']]) {
    assert.deepEqual(parseMessageSource(textPayload({
      extType, extBody: { bizType, bizData: { bizKey } },
    })), { source: 'exchange_request', ext_type: '206', biz_type: '6', biz_key: '10001' });
  }
});

test('来源只取决于协议，与正文、发送者和请求状态无关', () => {
  for (const [extType, source] of [[200, 'system'], [206, 'exchange_request'], [207, 'exchange_result']]) {
    for (const bodies of [[], [{ type: 'txt', msg: '任意文本' }]]) {
      const payload = JSON.stringify({
        bodies,
        ext: { extType, extBody: { bizType: '4', bizData: { status: '4' } } },
      });
      assert.equal(parseMessageSource(payload).source, source);
    }
  }
});

test('普通聊天仅识别已知业务码，不把其他业务文本当作普通聊天', () => {
  for (const bizType of ['', '1', 1]) {
    assert.equal(parseMessageSource(textPayload({ extType: 1, extBody: { bizType } })).source, 'chat');
  }
  for (const bizType of [undefined, '3', '4', '6', '7', '999']) {
    const result = parseMessageSource(textPayload({ extType: 1, extBody: { bizType } }));
    assert.equal(result.source, 'unknown');
    assert.equal(result.ext_type, '1');
    assert.equal(result.biz_type, bizType ?? null);
  }
});

test('未知协议码保留原值，不根据交换微信文案猜来源', () => {
  assert.deepEqual(parseMessageSource(textPayload({
    extType: 999, extBody: { bizType: 'future', bizData: { bizKey: 'future-key' } },
  })), { source: 'unknown', ext_type: '999', biz_type: 'future', biz_key: 'future-key' });
  assert.deepEqual(parseMessageSource(textPayload()), {
    source: 'unknown', ext_type: null, biz_type: null, biz_key: null,
  });
});

test('损坏或缺少元信息时显式返回 unknown，不影响其余消息', () => {
  const unknown = { source: 'unknown', ext_type: null, biz_type: null, biz_key: null };
  for (const payload of ['', '{bad-json', 'null', '[]', '{}', '42', '"text"', textPayload(null)]) {
    assert.deepEqual(parseMessageSource(payload), unknown);
  }
  assert.deepEqual(parseMessageSource(textPayload({
    extType: { code: 206 }, extBody: { bizType: ['6'], bizData: { bizKey: true } },
  })), unknown);
});

test('chatmsg: 同文的交换请求与普通聊天按协议区分，保留旧字段和时间顺序', async () => {
  // 交换请求结构取自脱敏后的联系人 lastPayload；普通聊天按前端默认发送协议合成。
  const list = [
    {
      msgId: 'newer',
      msgSendImId: 'me-im',
      msgTime: new Date(2026, 5, 3, 10, 2).getTime(),
      msgType: 'txt',
      payload: textPayload({ extType: 1, extBody: { bizType: '1' } }),
    },
    {
      msgId: 'older',
      msgSendImId: 'other-im',
      msgTime: new Date(2026, 5, 3, 10, 1).getTime(),
      msgType: 'txt',
      payload: textPayload({
        extType: 206,
        extBody: { bizType: '6', bizData: { bizKey: '10001', status: '4', data: 'private-value' } },
      }),
    },
  ];
  const requests: string[] = [];
  const page: any = {
    url: () => 'https://lpt.liepin.com/recommend',
    goto: async () => {},
    mainFrame: () => ({ client: { send: async () => {} } }),
    evaluate: async (_fn: any, ...args: any[]) => {
      if (args.length === 0) return 'me-im';
      assert.equal(args.length, 4);
      assert.equal(args[0], 'https://api-lpt.liepin.com/api/com.liepin.im.b.chat.chat-list');
      requests.push(args[1]);
      return { ok: true, status: 200, text: JSON.stringify({ flag: 1, data: { list } }) };
    },
  };

  const messages = await chatmsg(page, { oppositeImId: 'other-im', limit: 20 });

  assert.deepEqual(messages, [
    {
      sender: '对方', content: WECHAT_REQUEST, time: '2026-06-03 10:01', type: 'txt',
      source: 'exchange_request', ext_type: '206', biz_type: '6', biz_key: '10001',
    },
    {
      sender: '我', content: WECHAT_REQUEST, time: '2026-06-03 10:02', type: 'txt',
      source: 'chat', ext_type: '1', biz_type: '1', biz_key: null,
    },
  ]);
  assert.equal(JSON.stringify(messages).includes('private-value'), false);
  assert.equal(requests.length, 1);
  assert.equal(new URLSearchParams(requests[0]).get('oppositeImId'), 'other-im');
  assert.equal(new URLSearchParams(requests[0]).get('pageSize'), '20');
  assert.deepEqual(list.map(item => item.msgId), ['newer', 'older']);
  assert.ok(chatmsgCommand.columns.some(column => column.key === 'source'));
});

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
    {
      sender: '对方', content: '简历卡片', time: '', type: 'txt', card_resume_id: 'synthetic-card-id',
      source: 'unknown', ext_type: null, biz_type: null, biz_key: null,
    },
    {
      sender: '我', content: '普通文本', time: '', type: 'txt',
      source: 'unknown', ext_type: null, biz_type: null, biz_key: null,
    },
    {
      sender: '对方', content: '', time: '', type: 'txt',
      source: 'unknown', ext_type: null, biz_type: null, biz_key: null,
    },
    {
      sender: '对方', content: '简历卡片', time: '', type: 'txt',
      source: 'unknown', ext_type: null, biz_type: null, biz_key: null,
    },
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

test('chatmsg: 来源元信息与简历卡片解析同时保留，历史 ID 不覆盖当前 ID', async () => {
  const list = [{
    msgSendImId: 'synthetic-im',
    msgType: 'txt',
    payload: JSON.stringify({
      bodies: [{ type: 'txt', msg: '简历卡片' }],
      ext: {
        extType: 207,
        extBody: {
          bizType: '4',
          bizData: {
            bizKey: 'synthetic-resume-key',
            resumeInfo: { resumeId: 'synthetic-card-id', imId: 'synthetic-im', userId: 'synthetic-user' },
          },
        },
      },
    }),
  }];
  const expectedMessage = {
    sender: '对方', content: '简历卡片', time: '', type: 'txt',
    source: 'exchange_result', ext_type: '207', biz_type: '4', biz_key: 'synthetic-resume-key',
    card_resume_id: 'synthetic-card-id',
  };
  const defaultRun = fakePage(list);

  assert.deepEqual(await chatmsg(defaultRun.page, { oppositeImId: 'synthetic-im' }), [expectedMessage]);
  assert.equal(defaultRun.requests.length, 1);

  const resolvedRun = fakePage(list);

  assert.deepEqual(await chatmsg(resolvedRun.page, RESOLVE_OPTIONS), [{
    ...expectedMessage, resume_id: 'synthetic-current-id',
  }]);
  assert.deepEqual(resolvedRun.requests.slice(1), [{
    url: 'https://api-lpt.liepin.com/api/com.liepin.im.b.common.get-resume-id',
    body: 'usercIdEncode=synthetic-user',
    clientId: '40342',
  }]);
});
