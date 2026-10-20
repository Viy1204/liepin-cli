import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatmsg, chatmsgCommand, parseMessageSource } from './chatmsg.js';

const WECHAT_REQUEST = '为了方便联系，可以交换微信号吗？';

function textPayload(ext?: unknown) {
  return JSON.stringify({ bodies: [{ type: 'txt', msg: WECHAT_REQUEST }], ext });
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
