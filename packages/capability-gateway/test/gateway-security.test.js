import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { handleGatewayHttp } from '../dist/http.js';
import { drainGatewayTurns, resetInboundDedupe } from '../dist/inbound-guard.js';
import {
  parseGatewaySettingsPatch,
  readGatewaySettings,
  redactGatewaySettings,
  writeGatewaySettings
} from '../dist/gateway-settings.js';
import {
  call,
  fakeRuntime,
  feishuEncrypt,
  feishuMessageEvent,
  feishuSign,
  makeCtx
} from './gateway-harness.mjs';

beforeEach(() => resetInboundDedupe());

function feishuCtx({ spec = { enabled: true, verificationToken: 'tok' }, runtimeOpts, channels } = {}) {
  const runtime = fakeRuntime(runtimeOpts);
  const ctx = makeCtx({ runtime, fileConfig: { providers: { feishu: spec }, channels } });
  return { runtime, ctx };
}

const post = (ctx, body, headers) =>
  call(handleGatewayHttp, ctx, { path: '/providers/feishu/events', body, headers });

test('伪造令牌的飞书消息事件被拒绝且不运行 Agent [AC:gateway-im-security#AC-1]', async () => {
  const { runtime, ctx } = feishuCtx();
  const r = await post(ctx, feishuMessageEvent({ token: 'WRONG' }));
  await drainGatewayTurns();
  assert.ok(r.status === 401 || r.status === 403, `status ${r.status}`);
  assert.equal(runtime.calls.created.length, 0);
  assert.equal(runtime.calls.sent.length, 0);
  assert.equal(runtime.calls.ran.length, 0);
});

test('令牌正确的飞书消息事件被接受并处理 [AC:gateway-im-security#AC-2]', async () => {
  const { runtime, ctx } = feishuCtx();
  const r = await post(ctx, feishuMessageEvent({ token: 'tok', text: 'hello' }));
  await drainGatewayTurns();
  assert.equal(r.status, 200);
  assert.equal(runtime.calls.created.length, 1);
  assert.equal(runtime.calls.ran.length, 1);
});

test('加密密钥：签名缺失/错误被拒绝，正确则处理 [AC:gateway-im-security#AC-3]', async () => {
  const key = 'enc-key-1';
  const { runtime, ctx } = feishuCtx({ spec: { enabled: true, encryptKey: key } });
  const raw = JSON.stringify({ encrypt: feishuEncrypt(feishuMessageEvent({ token: 'ignored' }), key) });

  const missing = await call(handleGatewayHttp, ctx, { path: '/providers/feishu/events', rawBody: raw });
  const bad = await call(handleGatewayHttp, ctx, {
    path: '/providers/feishu/events',
    rawBody: raw,
    headers: feishuSign(raw, 'other-key')
  });
  await drainGatewayTurns();
  assert.equal(missing.status, 403);
  assert.equal(bad.status, 403);
  assert.equal(runtime.calls.ran.length, 0);

  const ok = await call(handleGatewayHttp, ctx, {
    path: '/providers/feishu/events',
    rawBody: raw,
    headers: feishuSign(raw, key)
  });
  await drainGatewayTurns();
  assert.equal(ok.status, 200);
  assert.equal(runtime.calls.ran.length, 1);
});

test('未配置令牌/密钥时消息事件默认被拒绝，URL 验证仍可用 [AC:gateway-im-security#AC-4]', async () => {
  const { runtime, ctx } = feishuCtx({ spec: { enabled: true } });
  const r = await post(ctx, feishuMessageEvent({ token: 'anything' }));
  await drainGatewayTurns();
  assert.equal(r.status, 403);
  assert.equal(runtime.calls.ran.length, 0);

  const ch = await post(ctx, { type: 'url_verification', challenge: 'abc' });
  assert.equal(ch.status, 200);
  assert.deepEqual(ch.json, { challenge: 'abc' });
});

test('同一 event_id 重复投递只处理一次 [AC:gateway-im-security#AC-5]', async () => {
  const { runtime, ctx } = feishuCtx();
  const ev = feishuMessageEvent({ eventId: 'ev_dup' });
  const a = await post(ctx, ev);
  const b = await post(ctx, ev);
  await drainGatewayTurns();
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(runtime.calls.created.length + runtime.calls.sent.length, 1);
  assert.equal(runtime.calls.ran.length, 1);
});

test('Agent 未完成时请求已立即返回 [AC:gateway-im-security#AC-6]', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { runtime, ctx } = feishuCtx({ runtimeOpts: { runSession: () => gate } });
  const r = await post(ctx, feishuMessageEvent({ eventId: 'ev_slow' }));
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(runtime.calls.ran.length, 1, 'agent started in background');
  let finished = false;
  const drained = drainGatewayTurns().then(() => (finished = true));
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(finished, false, 'agent still running after ack');
  release();
  await drained;
  assert.equal(finished, true);
});

test('飞书发送者白名单：非白名单不运行，白名单正常 [AC:gateway-im-security#AC-7]', async () => {
  const { runtime, ctx } = feishuCtx();
  writeGatewaySettings(runtime.store, { feishu: { allowedSenders: ['ou_ok'] } });
  const denied = await post(ctx, feishuMessageEvent({ openId: 'ou_evil' }));
  await drainGatewayTurns();
  assert.equal(denied.status, 200);
  assert.equal(runtime.calls.ran.length, 0);

  const allowed = await post(ctx, feishuMessageEvent({ openId: 'ou_ok' }));
  await drainGatewayTurns();
  assert.equal(allowed.status, 200);
  assert.equal(runtime.calls.ran.length, 1);
});

function wecomCtx(spec = { enabled: true }) {
  const runtime = fakeRuntime();
  const ctx = makeCtx({ runtime, fileConfig: { providers: { wecom: spec } } });
  return { runtime, ctx };
}
const wecomPost = (ctx, body) => call(handleGatewayHttp, ctx, { path: '/providers/wecom/bridge', body });

test('企微白名单：非白名单 403，白名单正常 [AC:gateway-im-security#AC-8]', async () => {
  const { runtime, ctx } = wecomCtx({ enabled: true, bridgeSecret: 's3' });
  writeGatewaySettings(runtime.store, { wecom: { allowedSenders: ['alice'] } });
  const denied = await wecomPost(ctx, { secret: 's3', userKey: 'mallory', text: 'hi' });
  assert.equal(denied.status, 403);
  assert.equal(runtime.calls.ran.length, 0);
  const ok = await wecomPost(ctx, { secret: 's3', userKey: 'alice', text: 'hi' });
  assert.equal(ok.status, 200);
  assert.equal(runtime.calls.ran.length, 1);
});

test('通用 webhook 白名单：无发送者或不在名单均 403 [AC:gateway-im-security#AC-9]', async () => {
  const runtime = fakeRuntime();
  const ctx = makeCtx({
    runtime,
    fileConfig: { channels: [{ id: 'hook', type: 'webhook', url: 'http://127.0.0.1:9/x' }] }
  });
  writeGatewaySettings(runtime.store, { webhook: { allowedSenders: ['42'] } });
  const tg = (from) => ({
    update_id: 1,
    message: { message_id: 1, chat: { id: 7 }, text: '/ping', ...(from ? { from: { id: from } } : {}) }
  });
  const anon = await call(handleGatewayHttp, ctx, { path: '/channels/hook/webhook', body: tg() });
  const other = await call(handleGatewayHttp, ctx, { path: '/channels/hook/webhook', body: tg(99) });
  assert.equal(anon.status, 403);
  assert.equal(other.status, 403);
  assert.equal(runtime.calls.ran.length, 0);
});

test('企微未配置 secret 时一律拒绝 [AC:gateway-im-security#AC-10]', async () => {
  const { runtime, ctx } = wecomCtx({ enabled: true });
  const r = await wecomPost(ctx, { userKey: 'alice', text: 'hi' });
  const r2 = await wecomPost(ctx, { secret: '', userKey: 'alice', text: 'hi' });
  assert.equal(r.status, 403);
  assert.equal(r2.status, 403);
  assert.equal(runtime.calls.ran.length, 0);
});

test('企微 secret 错误 403，正确则处理 [AC:gateway-im-security#AC-11]', async () => {
  const { runtime, ctx } = wecomCtx({ enabled: true, bridgeSecret: 's3' });
  const bad = await wecomPost(ctx, { secret: 'nope', userKey: 'alice', text: 'hi' });
  assert.equal(bad.status, 403);
  assert.equal(runtime.calls.ran.length, 0);
  const ok = await wecomPost(ctx, { secret: 's3', userKey: 'alice', text: 'hi' });
  assert.equal(ok.status, 200);
  assert.equal(runtime.calls.ran.length, 1);
});

test('设置保存后无需重启立即生效，读取不回显明文 [AC:gateway-im-security#AC-12]', async () => {
  const { runtime, ctx } = feishuCtx({ spec: { enabled: true } });
  const before = await post(ctx, feishuMessageEvent({ token: 'ui-tok' }));
  assert.equal(before.status, 403);

  const patch = parseGatewaySettingsPatch({ feishu: { verificationToken: 'ui-tok', encryptKey: null } });
  const saved = writeGatewaySettings(runtime.store, patch);
  const view = redactGatewaySettings(saved);
  assert.equal(view.feishu.verificationTokenSet, true);
  assert.equal(view.feishu.encryptKeySet, false);
  assert.ok(!JSON.stringify(view).includes('ui-tok'));

  const after = await post(ctx, feishuMessageEvent({ token: 'ui-tok' }));
  await drainGatewayTurns();
  assert.equal(after.status, 200);
  assert.equal(runtime.calls.ran.length, 1);

  const cleared = writeGatewaySettings(runtime.store, { feishu: { verificationToken: null } });
  assert.equal(readGatewaySettings(runtime.store).feishu.verificationToken, undefined);
  assert.equal(cleared.feishu.verificationToken, undefined);
  assert.throws(() => parseGatewaySettingsPatch({ feishu: { allowedSenders: 'x' } }), /allowedSenders/);
});

test('配置了 Bot 的飞书消息落进 Bot canonical 会话 [AC:gateway-im-security#AC-13]', async () => {
  const bots = { alice: { id: 'alice', canonicalSessionId: 'sess_alice' } };
  const { runtime, ctx } = feishuCtx({ runtimeOpts: { bots } });
  writeGatewaySettings(runtime.store, { feishu: { botId: 'alice' } });
  await post(ctx, feishuMessageEvent({ openId: 'ou_a', text: 'one' }));
  await post(ctx, feishuMessageEvent({ openId: 'ou_b', chatId: 'oc_9', chatType: 'group', text: 'two' }));
  await drainGatewayTurns();
  assert.equal(runtime.calls.created.length, 0, 'no IM session created');
  assert.deepEqual(runtime.calls.sent.map((s) => s.sessionId), ['sess_alice', 'sess_alice']);
  assert.deepEqual(runtime.calls.ran, ['sess_alice', 'sess_alice']);
});

test('网关 /chat 带 botId：存在则落 canonical 会话，不存在 404 [AC:gateway-im-security#AC-14]', async () => {
  const bots = { alice: { id: 'alice', canonicalSessionId: 'sess_alice' } };
  const runtime = fakeRuntime({ bots });
  const ctx = makeCtx({ runtime });
  const ok = await call(handleGatewayHttp, ctx, { path: '/chat', body: { message: 'yo', botId: 'alice' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(runtime.calls.sent.map((s) => s.sessionId), ['sess_alice']);
  assert.equal(runtime.calls.created.length, 0);

  const missing = await call(handleGatewayHttp, ctx, { path: '/chat', body: { message: 'yo', botId: 'ghost' } });
  assert.equal(missing.status, 404);
  assert.equal(runtime.calls.created.length, 0);
  assert.equal(runtime.calls.ran.length, 1);
});
