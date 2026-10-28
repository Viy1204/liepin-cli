import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestPhone, requestResume, requestPhoneCommand, requestResumeCommand } from './request.js';
import { parsePayload } from './chatmsg.js';
import { AuthExpiredError, PageUnavailableError, RiskControlError } from '../common/utils.js';

const RESUME_VIEW = 'resume-view';
const CHAT_LIST = 'chat-list';

function requestMessage(msgId: string, kind: 'phone' | 'resume' | 'wechat' = 'phone', sender = 'me-im', bizType = '4') {
  const kindCode = { phone: '2', resume: '3', wechat: '1' }[kind];
  return {
    msgId,
    msgSendImId: sender,
    payload: JSON.stringify({
      bodies: [{ type: 'txt', msg: '请求卡片' }],
      ext: { extType: 206, extBody: { bizType, bizData: { bizKey: `test-request-${kindCode}` } } },
    }),
  };
}

/**
 * 假 Page：按 lptFetch 的 url 实参分发响应，DOM 操作记在 calls 里。
 * lptFetch 的 evaluate 带 4 个实参，DOM 那些 evaluate 带 0~1 个，以此区分。
 */
function fakePage(opts: {
  actionMissing?: boolean;
  actionWaitError?: Error;
  disabledBefore?: boolean;
  disabledAfter?: boolean;
  newMessage?: boolean;
  dialog?: boolean;
  before?: any[];
  after?: any[];
  baselineResponse?: any;
  verificationResponse?: any;
  verificationError?: Error;
  oppositeImId?: string;
  selfImId?: string;
} = {}) {
  const calls: string[] = [];
  let clickedAction = false;
  let clickedKind: 'phone' | 'resume' = 'phone';

  const chatListResponse = (): string => {
    if (clickedAction && opts.verificationError) throw opts.verificationError;
    if (clickedAction && opts.verificationResponse !== undefined) return JSON.stringify(opts.verificationResponse);
    if (!clickedAction && opts.baselineResponse !== undefined) return JSON.stringify(opts.baselineResponse);
    const list = clickedAction
      ? opts.after ?? (opts.newMessage ? [requestMessage('msg-2', clickedKind)] : [requestMessage('msg-1', clickedKind)])
      : opts.before ?? [requestMessage('msg-1', clickedKind)];
    return JSON.stringify({ flag: 1, data: { list } });
  };

  const page: any = {
    url: () => 'https://lpt.liepin.com/resume/detail',
    goto: async () => {},
    mainFrame: () => ({ client: { send: async () => {} } }),
    waitForSelector: async (sel: string) => {
      if (sel.includes('action-')) {
        if (opts.actionWaitError) throw opts.actionWaitError;
        if (opts.actionMissing) throw new Error('timeout');
      }
      calls.push(`wait:${sel}`);
    },
    click: async (sel: string) => {
      calls.push(`click:${sel}`);
      if (sel.includes('action-')) {
        clickedAction = true;
        clickedKind = sel.endsWith('action-resume') ? 'resume' : 'phone';
      }
    },
    evaluate: async (_fn: any, ...args: any[]) => {
      if (args.length === 4) {
        const url = String(args[0]);
        if (url.includes(RESUME_VIEW)) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              flag: 1,
              data: {
                resumeDetailVo: { encodeUsercId: 'u-1', baseInfo: { name: '张三' } },
                imInfoVo: { usercImId: opts.oppositeImId ?? 'im-1' },
              },
            }),
          };
        }
        if (url.includes(CHAT_LIST)) return { ok: true, status: 200, text: chatListResponse() };
        return { ok: true, status: 200, text: JSON.stringify({ flag: 1, data: {} }) };
      }
      // readLptImId（无实参）
      if (args.length === 0) return opts.selfImId ?? 'me-im';
      // readActionState（选择器实参）
      const disabled = clickedAction ? opts.disabledAfter === true : opts.disabledBefore === true;
      return { text: '索要手机', disabled };
    },
  };

  // confirmDialogIfPresent 也是 0 实参的 evaluate，需要跟 readLptImId 区分：
  // 用调用顺序区分太脆弱，直接按返回值类型在被测代码里各取所需，这里统一给对象/字符串。
  const originalEvaluate = page.evaluate;
  page.evaluate = async (fn: any, ...args: any[]) => {
    const src = String(fn);
    if (src.includes('role="dialog"')) {
      calls.push('dialog-check');
      return opts.dialog === true;
    }
    return originalEvaluate(fn, ...args);
  };

  return { page, calls };
}

test('request-phone: 点的是「索要手机」按钮，并按会话新消息确认送达', async () => {
  const { page, calls } = fakePage({ newMessage: true });

  const res = await requestPhone(page, { resumeId: 'r-1' });

  assert.equal(res.success, true);
  assert.equal(res.confirmed, true);
  assert.equal(res.name, '张三');
  assert.ok(calls.includes('click:.im-ui-action-button.action-phone'));
});

test('request-resume: 点的是「索要简历」按钮，不会点成手机', async () => {
  const { page, calls } = fakePage({ newMessage: true });

  const result = await requestResume(page, { resumeId: 'r-1' });

  assert.equal(result.confirmed, true);
  assert.ok(calls.includes('click:.im-ui-action-button.action-resume'));
  assert.ok(!calls.some(c => c.includes('action-phone')));
});

test('会话里没多出消息、按钮也没变灰时，不谎称已送达', async () => {
  const { page } = fakePage({ newMessage: false });

  const res = await requestPhone(page, { resumeId: 'r-1' });

  assert.equal(res.confirmed, false);
  assert.match(res.message, /未能确认/);
});

test('只有按钮变灰不能证明请求已发送', async () => {
  const { page } = fakePage({ newMessage: false, disabledBefore: false, disabledAfter: true });

  const res = await requestPhone(page, { resumeId: 'r-1' });

  assert.equal(res.confirmed, false);
  assert.match(res.message, /未能确认/);
});

test('按钮一开始就不可点：直接返回失败，不做任何点击', async () => {
  const { page, calls } = fakePage({ disabledBefore: true, disabledAfter: true });

  const res = await requestPhone(page, { resumeId: 'r-1' });

  assert.equal(res.success, false);
  assert.match(res.message, /不可点/);
  assert.ok(!calls.some(c => c.startsWith('click:.im-ui-action-button')));
});

test('会话不存在（按钮没渲染）时报错指向 greet，不静默成功', async () => {
  const { page } = fakePage({ actionMissing: true });

  await assert.rejects(() => requestPhone(page, { resumeId: 'r-1' }), /greet/);
});

for (const [kind, request] of [['phone', requestPhone], ['resume', requestResume]] as const) {
  test(`request-${kind}: 按前端bizKey尾位解码目标请求，不限制未经实测的完整值`, async () => {
    for (const bizType of ['4', '6', '7']) {
      const { page } = fakePage({ before: [], after: [requestMessage('new', kind, 'me-im', bizType)] });
      const result = await request(page, { resumeId: 'r-1' });
      assert.equal(result.confirmed, true);
    }
  });

  for (const [label, after] of [
    ['候选人发来的请求', [requestMessage('new', kind, 'im-1')]],
    ['其他类型请求', [requestMessage('new', kind === 'phone' ? 'resume' : 'phone')]],
    ['微信请求', [requestMessage('new', 'wechat')]],
    ['不支持的业务类型', [requestMessage('new', kind, 'me-im', '99')]],
    ['缺少消息ID', [requestMessage('', kind)]],
    ['普通来信', [{ msgId: 'new', msgSendImId: 'im-1', payload: JSON.stringify({ bodies: [{ type: 'txt', msg: '无关来信' }] }) }]],
  ] as const) {
    test(`request-${kind}: ${label}不确认目标请求`, async () => {
      const { page, calls } = fakePage({ before: [], after: [...after] });
      const result = await request(page, { resumeId: 'r-1' });
      assert.equal(result.confirmed, false);
      assert.match(result.message, /未能确认/);
      assert.match(result.message, /不要自动重发/);
      assert.equal(calls.filter(call => call.startsWith('click:.im-ui-action-button')).length, 1);
    });
  }

  test(`request-${kind}: 旧请求消息不能当成本次发送`, async () => {
    const existing = requestMessage('old', kind);
    const { page } = fakePage({ before: [existing], after: [existing] });
    assert.equal((await request(page, { resumeId: 'r-1' })).confirmed, false);
  });

  for (const [label, options] of [
    ['候选人imId缺失', { oppositeImId: '' }],
    ['自己的imId缺失', { selfImId: '' }],
  ] as const) {
    test(`request-${kind}: ${label}时不能把旧记录确认成新请求`, async () => {
      const { page } = fakePage({ ...options, after: [requestMessage('old', kind)] });
      const result = await request(page, { resumeId: 'r-1' });
      assert.equal(result.confirmed, false);
    });
  }

  for (const [label, baselineResponse] of [
    ['基线业务响应失败', { flag: 0, msg: '临时不可用' }],
    ['基线列表缺失', { flag: 1, data: {} }],
  ] as const) {
    test(`request-${kind}: ${label}时在索要点击前报错`, async () => {
      const { page, calls } = fakePage({ baselineResponse });
      await assert.rejects(() => request(page, { resumeId: 'r-1' }), /基线/);
      assert.ok(!calls.some(call => call.startsWith('click:.im-ui-action-button')));
    });
  }

  test(`request-${kind}: 点击后确认接口普通失败时返回未确认`, async () => {
    const { page, calls } = fakePage({ verificationResponse: { flag: 0, msg: '临时不可用' } });
    const result = await request(page, { resumeId: 'r-1' });
    assert.equal(result.confirmed, false);
    assert.equal(calls.filter(call => call.startsWith('click:.im-ui-action-button')).length, 1);
  });

  for (const ErrorType of [AuthExpiredError, RiskControlError, PageUnavailableError]) {
    test(`request-${kind}: 点击后验证发生${ErrorType.name}时原样传播且不重发`, async () => {
      const error = new ErrorType('验证失败');
      const { page, calls } = fakePage({ verificationError: error });
      await assert.rejects(() => request(page, { resumeId: 'r-1' }), value => value === error);
      assert.equal(calls.filter(call => call.startsWith('click:.im-ui-action-button')).length, 1);
    });
  }

  for (const [reason, ErrorType] of [
    ['页面失效', PageUnavailableError],
    ['触发风控', RiskControlError],
    ['登录态失效', AuthExpiredError],
  ] as const) {
    test(`request-${kind}: 等待动作按钮时${reason}原样传播，不点击或引导 greet`, async () => {
      const actionError = new ErrorType(`等待动作按钮时${reason}`);
      const { page, calls } = fakePage({ actionWaitError: actionError });

      await assert.rejects(() => request(page, { resumeId: 'r-1' }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /greet/);
        assert.strictEqual(error, actionError);
        return true;
      });
      assert.ok(!calls.some(c => c.startsWith('click:.im-ui-action-button')));
    });
  }
}

test('空 resume_id 直接报错', async () => {
  const { page } = fakePage();
  await assert.rejects(() => requestPhone(page, { resumeId: '' }), /不能为空/);
});

test('命令定义：名字与必需参数符合 CLI 契约', () => {
  for (const cmd of [requestPhoneCommand, requestResumeCommand]) {
    assert.match(cmd.name, /^request-(phone|resume)$/);
    const arg = cmd.args[0];
    assert.equal(arg.required, true);
    assert.equal(arg.positional, true);
  }
});

test('chatmsg: 卡片消息里的手机号明文抽出来，不再只显示 [类型]', () => {
  const card = JSON.stringify({ bodies: [{ type: 'cmd', action: 'phone', ext: { phone: '13800138000' } }] });
  assert.equal(parsePayload(card), '[cmd] 13800138000');
});

test('chatmsg: 普通文本消息原样返回', () => {
  const txt = JSON.stringify({ bodies: [{ type: 'txt', msg: '您好，方便聊聊吗' }] });
  assert.equal(parsePayload(txt), '您好，方便聊聊吗');
});

test('chatmsg: 卡片里没有号码时保持原来的 [类型]', () => {
  const card = JSON.stringify({ bodies: [{ type: 'img', url: 'https://x/y.png' }] });
  assert.equal(parsePayload(card), '[img]');
});
