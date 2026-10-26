import assert from 'node:assert/strict';
import { handle as handleWorker, signPayload } from '../worker/src/handle.js';
import { createSmtpServer, parseMime } from './smtp-mock.mjs';

// Visitor mail goes over SMTP; record it in the same `sent` list in the Resend body shape.
const handle = (request, env, fetchImpl) => handleWorker(request, env, fetchImpl, { connect: env.__smtp.connect });
import { ENTER_UNAVAILABLE, approveEmail, declineEmail, entryUrl, reviewEmail } from '../worker/src/emails.js';

function createKv() {
  const map = new Map();
  const meta = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async getWithMetadata(key) {
      return { value: map.has(key) ? map.get(key) : null, metadata: meta.get(key) || null };
    },
    async put(key, value, options = {}) {
      map.set(key, value instanceof ArrayBuffer ? value : String(value));
      if (options.metadata) meta.set(key, options.metadata);
    },
    async delete(key) {
      map.delete(key);
      meta.delete(key);
    },
    async list({ prefix = '' } = {}) {
      return { keys: [...map.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

function createEnv() {
  const sent = [];
  const env = {
    THOUGHTS: createKv(),
    OWNER_EMAIL: 'owner@example.com',
    ALLOWED_ORIGIN: 'https://kukudelin.top',
    SITE_ORIGIN: 'https://kukudelin.top',
    WORKER_ORIGIN: 'https://thoughts.kukudelin.top',
    RESEND_FROM: '林勇 <thoughts@example.com>',
    RESEND_API_KEY: 'test-resend',
    HMAC_SECRET: 'test-hmac-secret',
    UPLOAD_TOKEN: 'test-upload-token',
    now: () => 1_700_000_000_000,
    QQ_SMTP_PASS: 'test-smtp-pass',
  };
  env.__smtp = createSmtpServer({
    onMessage({ rcpt, data }) {
      const mime = parseMime(data);
      sent.push({ url: 'smtp://smtp.qq.com:465', mime, body: { from: mime.decoded.from, to: [rcpt], subject: mime.decoded.subject, reply_to: mime.decoded.replyTo, text: mime.parts['text/plain'], html: mime.parts['text/html'] } });
    },
  });
  const fetchImpl = async (url, options = {}) => {
    sent.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return new Response('{}', { status: 200 });
  };
  return { env, sent, fetchImpl };
}

function request(path, { method = 'GET', body, origin, cookie, auth, form } = {}) {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (cookie) headers.set('cookie', cookie);
  if (auth) headers.set('authorization', auth);
  let payload;
  if (form) {
    headers.set('content-type', 'application/x-www-form-urlencoded');
    payload = new URLSearchParams(form);
  } else if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }
  return new Request(`https://thoughts.kukudelin.top${path}`, { method, headers, body: payload });
}

const origin = 'https://kukudelin.top';

const { env, sent, fetchImpl } = createEnv();
const call = (req) => handle(req, env, fetchImpl);

const bad = await call(request('/api/apply', { method: 'POST', origin, body: { answer: '好', email: 'not-an-email' } }));
assert.equal(bad.status, 400);

const bot = await call(request('/api/apply', {
  method: 'POST',
  origin,
  body: { answer: '一段足够长的话', email: 'bot@example.com', website: 'https://spam.test' },
}));
assert.equal(bot.status, 200);
assert.equal(sent.length, 0);
assert.equal(await env.THOUGHTS.get('email:bot@example.com'), null);

const blocked = await call(request('/api/apply', {
  method: 'POST',
  body: { answer: '一段足够长的话', email: 'person@example.com' },
  origin: 'https://evil.example',
}));
assert.equal(blocked.status, 403);

const applied = await call(request('/api/apply', {
  method: 'POST',
  origin,
  body: { answer: '我想回到那个下雨的下午。', email: 'Person@Example.com' },
}));
assert.equal(applied.status, 200);
assert.equal(sent.length, 1);
assert.equal(sent[0].body.to[0], 'owner@example.com');
assert.match(sent[0].body.html, /我想回到那个下雨的下午/);
assert.match(sent[0].body.html, /person@example.com/);
assert.match(sent[0].body.html, /同意/);
assert.match(sent[0].body.html, /拒绝/);
assert.match(sent[0].body.text, /我想回到那个下雨的下午/);
assert.match(sent[0].body.text, /同意：https:\/\/thoughts\.kukudelin\.top\/review\?token=/);
assert.doesNotMatch(sent[0].body.text, /<|&amp;/);
assert.equal(sent[0].body.reply_to, undefined);
const approveUrl = new URL(sent[0].body.html.match(/href="(https:\/\/thoughts\.kukudelin\.top\/review\?token=[^"]+)"/)[1].replaceAll('&amp;', '&'));
const rejectUrl = [...sent[0].body.html.matchAll(/href="(https:\/\/thoughts\.kukudelin\.top\/review\?token=[^"]+)"/g)][1][1].replaceAll('&amp;', '&');

const preview = await call(request(approveUrl.pathname + approveUrl.search));
assert.equal(preview.status, 200);
assert.equal(sent.length, 1);
assert.match(await preview.text(), /确认同意/);

const again = await call(request('/api/apply', {
  method: 'POST',
  origin,
  body: { answer: '另一段话也写在这里。', email: 'person@example.com' },
}));
assert.equal(again.status, 200);
// A second answer while still pending reaches the owner again instead of silently vanishing.
assert.equal(sent.length, 2);
assert.equal(sent[1].body.to[0], 'owner@example.com');
assert.match(sent[1].body.html, /另一段话也写在这里/);
sent.splice(1, 1);

for (let index = 0; index < 3; index += 1) {
  const extra = await call(request('/api/apply', {
    method: 'POST',
    origin,
    body: { answer: `第 ${index} 次另外的申请内容`, email: `other${index}@example.com` },
  }));
  assert.equal(extra.status, 200);
}
const limited = await call(request('/api/apply', {
  method: 'POST',
  origin,
  body: { answer: '这次应该被挡住。', email: 'late@example.com' },
}));
assert.equal(limited.status, 429);

for (let index = 0; index < 3; index += 1) {
  const prefetch = await call(request(approveUrl.pathname + approveUrl.search));
  assert.equal(prefetch.status, 200);
}
const rawToken = approveUrl.searchParams.get('token');
const foreignReview = await call(request('/review', { method: 'POST', origin: 'https://evil.example', form: { token: rawToken } }));
assert.equal(foreignReview.status, 403);
assert.match(foreignReview.headers.get('content-type'), /text\/html/);
assert.match(await foreignReview.text(), /无法确认/);
const forged = await call(request('/review', { method: 'POST', origin: 'null', form: { token: `${rawToken.split('.')[0]}.AAAA` } }));
assert.equal(forged.status, 400);
assert.match(forged.headers.get('content-type'), /text\/html/);
const wrongMethod = await call(request('/review', { method: 'PUT' }));
assert.equal(wrongMethod.status, 405);
assert.match(wrongMethod.headers.get('content-type'), /text\/html/);
for (const variant of [encodeURIComponent(encodeURIComponent(rawToken)), ` ${rawToken}\n`, `${rawToken})`, `${rawToken}&amp;utm=x`]) {
  const viewed = await call(request(`/review?token=${encodeURIComponent(variant)}`));
  assert.equal(viewed.status, 200, variant);
  assert.match(await viewed.text(), /确认同意/);
}

const approved = await call(request('/review', { method: 'POST', origin: 'https://thoughts.kukudelin.top', form: { token: encodeURIComponent(rawToken) } }));
assert.equal(approved.status, 200);
assert.match(await approved.text(), /已同意/);
const visitorMail = sent.at(-1);
assert.equal(visitorMail.body.to[0], 'person@example.com');
assert.equal(visitorMail.url, 'smtp://smtp.qq.com:465');
assert.equal(visitorMail.body.from, '林勇 <3224688576@qq.com>');
assert.equal(visitorMail.body.reply_to, '林勇 <3224688576@qq.com>');
assert.equal(env.__smtp.sessions.at(-1).username, '3224688576@qq.com');
assert.equal(env.__smtp.sessions.at(-1).password, 'test-smtp-pass');
assert.deepEqual(env.__smtp.sessions.at(-1).options, { secureTransport: 'on', allowHalfOpen: false });
assert.equal(env.__smtp.sessions.at(-1).address.hostname, 'smtp.qq.com');
assert.ok(env.__smtp.sessions.at(-1).closed);
assert.match(visitorMail.body.text, /^个人随想\n\n我想起你了\n\n/);
assert.match(visitorMail.body.html, /进入个人随想/);
assert.equal(visitorMail.body.subject, '我想起你了');
assert.match(visitorMail.body.text, /这个链接只属于你，请别转给别人。/);
assert.match(visitorMail.body.text, /七天内点开一次就能进来/);
const accessUrl = visitorMail.body.html.match(/href="(https:\/\/thoughts\.kukudelin\.top\/enter\?token=[^"]+)"/)[1];
assert.ok(visitorMail.body.text.includes(accessUrl));
assert.doesNotMatch(visitorMail.body.html, /thoughts\/list\/#/);
assert.doesNotMatch(visitorMail.body.text, /thoughts\/list\/#/);
const entryPath = new URL(accessUrl).pathname + new URL(accessUrl).search;
const previewEntry = await call(request(entryPath, { method: 'POST' }));
assert.equal(previewEntry.status, 302);
assert.equal(new URL(previewEntry.headers.get('location')).searchParams.get('email'), null);
const entered = await call(request(entryPath));
assert.equal(entered.status, 302);
assert.equal(entered.headers.get('location'), 'https://kukudelin.top/thoughts/list/');
const cookie = entered.headers.get('set-cookie');
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /Domain=\.kukudelin\.top/);
const reused = await call(request(entryPath));
assert.equal(reused.status, 302);
assert.equal(reused.headers.get('set-cookie'), null);
const reusedBack = new URL(reused.headers.get('location'));
assert.equal(reusedBack.origin + reusedBack.pathname, 'https://kukudelin.top/thoughts/');
assert.equal(reusedBack.searchParams.get('link'), '1');
assert.equal(reusedBack.searchParams.get('email'), 'person@example.com');
assert.equal(reusedBack.searchParams.get('token'), null);
const appId = await env.THOUGHTS.get('email:person@example.com');
const expiredToken = await signPayload(env.HMAC_SECRET, {
  action: 'enter',
  id: appId,
  email: 'person@example.com',
  jti: crypto.randomUUID(),
  exp: env.now() - 1,
});
const expiredEntry = await call(request(`/enter?token=${encodeURIComponent(expiredToken)}`));
assert.equal(expiredEntry.status, 302);
assert.equal(expiredEntry.headers.get('set-cookie'), null);
const expiredBack = new URL(expiredEntry.headers.get('location'));
assert.equal(expiredBack.searchParams.get('link'), '1');
assert.equal(expiredBack.searchParams.get('email'), 'person@example.com');
const tampered = await call(request(`/enter?token=${encodeURIComponent(`${expiredToken.split('.')[0]}.aaaa`)}`));
assert.equal(tampered.status, 302);
assert.equal(tampered.headers.get('set-cookie'), null);
const tamperedBack = new URL(tampered.headers.get('location'));
assert.equal(tamperedBack.searchParams.get('link'), '1');
assert.equal(tamperedBack.searchParams.get('email'), null);

const approvedAgain = await call(request('/review', { method: 'POST', origin: 'null', form: { token: approveUrl.searchParams.get('token') } }));
assert.equal(approvedAgain.status, 200);
assert.match(approvedAgain.headers.get('content-type'), /text\/html/);
assert.match(await approvedAgain.text(), /已经同意过了/);
assert.equal(sent.at(-1), visitorMail);

const flipped = await call(request(new URL(rejectUrl).pathname + new URL(rejectUrl).search, { method: 'GET' }));
assert.match(await flipped.text(), /已经同意过了/);

const accessNames = (await env.THOUGHTS.list({ prefix: 'access:' })).keys.map((key) => key.name);
assert.equal(accessNames.length, 1);
const accessToken = accessNames[0].slice('access:'.length);
assert.equal(visitorMail.body.html.includes(accessToken), false);
assert.equal(visitorMail.body.text.includes(accessToken), false);
const session = await call(request('/api/session', { method: 'POST', origin, body: { token: accessToken } }));
assert.equal(session.status, 200);
assert.match(session.headers.get('set-cookie'), /HttpOnly/);
assert.equal(decodeURIComponent(/thoughts_session=([^;]+)/.exec(cookie)[1]), accessToken);
const saved = await call(request('/admin/thoughts', {
  method: 'PUT',
  auth: 'Bearer test-upload-token',
  body: { slug: 'rainy-afternoon', title: '下雨的下午', date: '2026-10-20', markdown: '只写给进得来的人。\n\n<script>alert(1)</script>' },
}));
assert.equal(saved.status, 200);
const hidden = await call(request('/api/thoughts', { origin }));
assert.equal(hidden.status, 401);
const listed = await call(request('/api/thoughts', { origin, cookie }));
assert.equal(listed.status, 200);
const items = await listed.json();
assert.equal(items.items[0].title, '下雨的下午');
assert.equal(items.items[0].markdown, undefined);
const post = await call(request('/api/thoughts/rainy-afternoon', { origin, cookie }));
const article = await post.json();
assert.match(article.markdown, /script/);

assert.deepEqual(article.tags, []);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const assetPut = (auth, type = 'image/jpeg') => call(new Request('https://thoughts.kukudelin.top/admin/thoughts/rainy-afternoon/assets/rain.jpg', {
  method: 'PUT',
  headers: { authorization: auth, 'content-type': type },
  body: jpeg,
}));
assert.equal((await assetPut('Bearer wrong')).status, 401);
assert.equal((await assetPut('Bearer test-upload-token', 'text/html')).status, 415);
assert.equal((await assetPut('Bearer test-upload-token')).status, 200);
const lockedImage = await call(request('/api/thoughts/rainy-afternoon/assets/rain.jpg'));
assert.equal(lockedImage.status, 401);
const image = await call(request('/api/thoughts/rainy-afternoon/assets/rain.jpg', { cookie }));
assert.equal(image.status, 200);
assert.equal(image.headers.get('content-type'), 'image/jpeg');
assert.match(image.headers.get('cache-control'), /private/);
assert.equal(new Uint8Array(await image.arrayBuffer()).length, 4);
assert.equal((await call(request('/api/thoughts/rainy-afternoon/assets/..%2Fx', { cookie }))).status, 404);

const tagged = await call(request('/admin/thoughts', {
  method: 'PUT',
  auth: 'Bearer test-upload-token',
  body: { slug: 'tagged', title: '有标签', date: '2026-02-02', tags: ['分享', '日常'], markdown: '正文' },
}));
assert.equal(tagged.status, 200);
const taggedPost = await (await call(request('/api/thoughts/tagged', { cookie }))).json();
assert.deepEqual(taggedPost.tags, ['分享', '日常']);
const removed = await call(request('/admin/thoughts/rainy-afternoon', { method: 'DELETE', auth: 'Bearer test-upload-token' }));
assert.equal(removed.status, 200);
assert.equal((await call(request('/api/thoughts/rainy-afternoon/assets/rain.jpg', { cookie }))).status, 404);

const foreign = await call(request('/admin/thoughts', {
  method: 'PUT',
  origin,
  auth: 'Bearer test-upload-token',
  body: { slug: 'nope', title: '不该写入', date: '2026-01-01', markdown: 'no' },
}));
assert.equal(foreign.status, 403);

const { env: env2, sent: sent2, fetchImpl: fetch2 } = createEnv();
const rejectedApply = await handle(request('/api/apply', {
  method: 'POST',
  origin,
  body: { answer: '也许是初次见面的那一天。', email: 'quiet@example.com' },
}), env2, fetch2);
assert.equal(rejectedApply.status, 200);
const reviewLinks = [...sent2[0].body.html.matchAll(/href="(https:\/\/thoughts\.kukudelin\.top\/review\?token=[^"]+)"/g)]
  .map((match) => match[1].replaceAll('&amp;', '&'));
const rejectToken = new URL(reviewLinks[1]).searchParams.get('token');
const declined = await handle(request('/review', { method: 'POST', form: { token: rejectToken } }), env2, fetch2);
assert.match(await declined.text(), /已拒绝/);
assert.match(sent2.at(-1).body.html, /我还没能想起你是谁/);
assert.equal(sent2.at(-1).body.subject, '关于你讲的那个瞬间');
assert.match(sent2.at(-1).body.text, /—— 小牛/);
assert.equal(sent2.at(-1).url, 'smtp://smtp.qq.com:465');
assert.equal(sent2.at(-1).body.reply_to, '林勇 <3224688576@qq.com>');
assert.doesNotMatch(sent2.at(-1).body.html, /thoughts\/list/);
const declinedAgain = await handle(request('/review', { method: 'POST', form: { token: rejectToken } }), env2, fetch2);
assert.match(await declinedAgain.text(), /已经拒绝过了/);
assert.equal(sent2.length, 2);

// A failed SMTP send must answer 502 and leave the application pending, for approve and reject alike.
for (const [failAt, linkIndex] of [['AUTH password', 0], ['RCPT TO', 1], ['greeting', 0]]) {
  const { env: env4, sent: sent4, fetchImpl: fetch4 } = createEnv();
  env4.__smtp = createSmtpServer({ failAt });
  await handle(request('/api/apply', { method: 'POST', origin, body: { answer: '那年冬天的车站。', email: 'fail@example.com' } }), env4, fetch4);
  const links = [...sent4[0].body.html.matchAll(/href="(https:\/\/thoughts\.kukudelin\.top\/review\?token=[^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
  const token = new URL(links[linkIndex]).searchParams.get('token');
  const failed = await handle(request('/review', { method: 'POST', form: { token } }), env4, fetch4);
  assert.equal(failed.status, 502, failAt);
  const appKey = (await env4.THOUGHTS.list({ prefix: 'apply:' })).keys[0].name;
  assert.equal(JSON.parse(await env4.THOUGHTS.get(appKey)).status, 'pending');
  assert.equal((await env4.THOUGHTS.list({ prefix: 'access:' })).keys.length, 0);
}
{
  const { env: env5, sent: sent5, fetchImpl: fetch5 } = createEnv();
  delete env5.QQ_SMTP_PASS;
  await handle(request('/api/apply', { method: 'POST', origin, body: { answer: '没有授权码的时候。', email: 'nopass@example.com' } }), env5, fetch5);
  const link = sent5[0].body.html.match(/href="(https:\/\/thoughts\.kukudelin\.top\/review\?token=[^"]+)"/)[1].replaceAll('&amp;', '&');
  const failed = await handle(request('/review', { method: 'POST', form: { token: new URL(link).searchParams.get('token') } }), env5, fetch5);
  assert.equal(failed.status, 502);
  assert.equal(env5.__smtp.sessions.length, 0);
}

const stale = await signPayload(env.HMAC_SECRET, { action: 'approve', id: 'missing', exp: 1 });
const expired = await call(request(`/review?token=${encodeURIComponent(stale)}`));
assert.equal(expired.status, 410);

assert.match(reviewEmail({ answer: '<b>', email: 'a@b.co', approveUrl: 'https://example.com/a', rejectUrl: 'https://example.com/b' }), /&lt;b&gt;/);
assert.match(approveEmail({ accessUrl: 'https://kukudelin.top/thoughts/list/#abc' }), /abc/);
assert.equal(entryUrl('https://thoughts.kukudelin.top/', 'abc.def'), 'https://thoughts.kukudelin.top/enter?token=abc.def');
assert.match(declineEmail(), /—— 小牛/);

{
  const { env: env3, sent: sent3, fetchImpl: fetch3 } = createEnv();
  env3.OWNER_PASSPHRASE = crypto.randomUUID();
  const call3 = (req, ip = '203.0.113.7') => {
    req.headers.set('cf-connecting-ip', ip);
    return handle(req, env3, fetch3);
  };
  const owner = await call3(request('/api/apply', { method: 'POST', origin, body: { answer: ` ${env3.OWNER_PASSPHRASE} `, email: '' } }));
  assert.equal(owner.status, 200);
  assert.equal((await owner.json()).status, 'owner');
  const ownerCookie = owner.headers.get('set-cookie');
  assert.match(ownerCookie, /thoughts_session=[^;]+; HttpOnly; Secure; SameSite=Lax/);
  assert.equal(sent3.length, 0);
  const ownerToken = decodeURIComponent(/thoughts_session=([^;]+)/.exec(ownerCookie)[1]);
  const ownerList = await call3(request('/api/thoughts', { origin, cookie: `thoughts_session=${encodeURIComponent(ownerToken)}` }));
  assert.equal(ownerList.status, 200);

  const noEmail = await call3(request('/api/apply', { method: 'POST', origin, body: { answer: '某个夏天', email: '' } }));
  assert.equal(noEmail.status, 400);
  const normal = await call3(request('/api/apply', { method: 'POST', origin, body: { answer: '某个夏天', email: 'friend@example.com' } }), '203.0.113.8');
  assert.equal(normal.status, 200);
  assert.equal((await normal.json()).status, 'pending');
  assert.equal(normal.headers.get('set-cookie'), null);
  assert.equal(sent3.length, 1);

  for (let index = 0; index < 4; index += 1) {
    const wrong = await call3(request('/api/apply', { method: 'POST', origin, body: { answer: `猜错${index}`, email: '' } }), '198.51.100.9');
    assert.equal(wrong.status, 400);
  }
  // fifth wrong guess counts; afterwards even the right phrase is refused for this IP
  await call3(request('/api/apply', { method: 'POST', origin, body: { answer: '猜错4', email: '' } }), '198.51.100.9');
  const blocked = await call3(request('/api/apply', { method: 'POST', origin, body: { answer: env3.OWNER_PASSPHRASE, email: '' } }), '198.51.100.9');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('set-cookie'), null);
  const otherIp = await call3(request('/api/apply', { method: 'POST', origin, body: { answer: env3.OWNER_PASSPHRASE, email: '' } }), '198.51.100.10');
  assert.equal(otherIp.status, 200);
  const nextWindow = { ...env3, now: () => Date.now() + 11 * 60 * 1000 };
  const later = new Request(request('/api/apply', { method: 'POST', origin, body: { answer: env3.OWNER_PASSPHRASE, email: '' } }));
  later.headers.set('cf-connecting-ip', '198.51.100.9');
  assert.equal((await handle(later, nextWindow, fetch3)).status, 200);
}

{
  const { env: enterEnv, fetchImpl: enterFetch } = createEnv();
  const callEnter = (email, ip = '203.0.113.20') => {
    const req = request('/api/enter', { method: 'POST', origin, body: { email } });
    req.headers.set('cf-connecting-ip', ip);
    return handle(req, enterEnv, enterFetch);
  };
  const sessionToken = crypto.randomUUID();
  const rejectedToken = crypto.randomUUID();
  const revokedToken = crypto.randomUUID();
  await enterEnv.THOUGHTS.put('email:ok@example.com', 'app-ok');
  await enterEnv.THOUGHTS.put('apply:app-ok', JSON.stringify({
    id: 'app-ok', email: 'ok@example.com', status: 'approved', accessToken: sessionToken,
  }));
  await enterEnv.THOUGHTS.put(`access:${sessionToken}`, JSON.stringify({
    email: 'ok@example.com', appId: 'app-ok', createdAt: 1, revoked: false,
  }));
  await enterEnv.THOUGHTS.put('email:wait@example.com', 'app-wait');
  await enterEnv.THOUGHTS.put('apply:app-wait', JSON.stringify({
    id: 'app-wait', email: 'wait@example.com', status: 'pending',
  }));
  await enterEnv.THOUGHTS.put('email:no@example.com', 'app-no');
  await enterEnv.THOUGHTS.put('apply:app-no', JSON.stringify({
    id: 'app-no', email: 'no@example.com', status: 'rejected', accessToken: rejectedToken,
  }));
  await enterEnv.THOUGHTS.put('email:revoked@example.com', 'app-revoked');
  await enterEnv.THOUGHTS.put('apply:app-revoked', JSON.stringify({
    id: 'app-revoked', email: 'revoked@example.com', status: 'approved', accessToken: revokedToken,
  }));
  await enterEnv.THOUGHTS.put(`access:${revokedToken}`, JSON.stringify({
    email: 'revoked@example.com', appId: 'app-revoked', createdAt: 1, revoked: true,
  }));

  const granted = await callEnter('  OK@Example.com  ');
  assert.equal(granted.status, 200);
  const grantedBody = await granted.json();
  assert.deepEqual(grantedBody, { ok: true, status: 'granted' });
  const enterCookie = granted.headers.get('set-cookie');
  assert.match(enterCookie, /thoughts_session=[^;]+; HttpOnly; Secure; SameSite=Lax/);
  assert.equal(decodeURIComponent(/thoughts_session=([^;]+)/.exec(enterCookie)[1]), sessionToken);
  const listed = await handle(request('/api/thoughts', { origin, cookie: enterCookie }), enterEnv, enterFetch);
  assert.equal(listed.status, 200);

  let gets = 0;
  const inner = enterEnv.THOUGHTS;
  enterEnv.THOUGHTS = {
    async get(key) {
      gets += 1;
      return inner.get(key);
    },
    getWithMetadata: (key) => inner.getWithMetadata(key),
    put: (key, value, options) => inner.put(key, value, options),
    delete: (key) => inner.delete(key),
    list: (options) => inner.list(options),
  };
  async function denied(email, ip) {
    gets = 0;
    const response = await callEnter(email, ip);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    const reads = gets;
    return { body: await response.json(), reads };
  }
  const pending = await denied('Wait@Example.com', '203.0.113.21');
  const rejected = await denied('no@example.com', '203.0.113.22');
  const missing = await denied('missing@example.com', '203.0.113.23');
  const revoked = await denied('revoked@example.com', '203.0.113.24');
  assert.deepEqual(pending.body, { ok: false, message: ENTER_UNAVAILABLE });
  assert.equal(ENTER_UNAVAILABLE, '这个邮箱暂时进不来。可以先提交申请，或者过会儿再试。');
  assert.deepEqual(pending.body, rejected.body);
  assert.deepEqual(pending.body, missing.body);
  assert.deepEqual(pending.body, revoked.body);
  assert.equal(pending.reads, rejected.reads);
  assert.equal(pending.reads, missing.reads);
  assert.equal(pending.reads, revoked.reads);
  assert.doesNotMatch(JSON.stringify(pending.body), /pending|rejected|missing|revoked|不存在|待审|拒绝|无权限|验证失败/);

  for (let index = 0; index < 4; index += 1) {
    const again = await callEnter('ok@example.com', `203.0.113.${30 + index}`);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).status, 'granted');
  }
  const limitedEmail = await callEnter('ok@example.com', '203.0.113.40');
  assert.equal(limitedEmail.status, 429);
  assert.equal(limitedEmail.headers.get('set-cookie'), null);
  assert.deepEqual(await limitedEmail.json(), { error: 'rate_limited' });

  const ip = '198.51.100.50';
  for (let index = 0; index < 5; index += 1) {
    const response = await callEnter(`nobody${index}@example.com`, ip);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), pending.body);
  }
  const limitedIp = await callEnter('nobody5@example.com', ip);
  assert.equal(limitedIp.status, 429);
  const otherIp = await callEnter('nobody5@example.com', '198.51.100.51');
  assert.equal(otherIp.status, 200);
  assert.deepEqual(await otherIp.json(), pending.body);

  const later = { ...enterEnv, now: () => enterEnv.now() + 11 * 60 * 1000 };
  const retry = request('/api/enter', { method: 'POST', origin, body: { email: 'ok@example.com' } });
  retry.headers.set('cf-connecting-ip', '203.0.113.40');
  const after = await handle(retry, later, enterFetch);
  assert.equal(after.status, 200);
  assert.equal((await after.json()).status, 'granted');

  const badMail = await callEnter('not-an-email', '203.0.113.60');
  assert.equal(badMail.status, 400);
  assert.equal(badMail.headers.get('set-cookie'), null);
}

console.log('thoughts worker tests ok');
