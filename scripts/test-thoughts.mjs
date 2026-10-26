import assert from 'node:assert/strict';
import { handle, signPayload } from '../worker/src/handle.js';
import { approveEmail, declineEmail, reviewEmail } from '../worker/src/emails.js';

function createKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
    async delete(key) {
      map.delete(key);
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
  };
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
assert.equal(sent.length, 1);

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

const approved = await call(request('/review', { method: 'POST', form: { token: approveUrl.searchParams.get('token') } }));
assert.equal(approved.status, 200);
assert.match(await approved.text(), /已同意/);
const visitorMail = sent.at(-1);
assert.equal(visitorMail.body.to[0], 'person@example.com');
assert.match(visitorMail.body.html, /进入个人随想/);
assert.match(visitorMail.body.subject, /入口/);
const accessUrl = visitorMail.body.html.match(/href="(https:\/\/kukudelin\.top\/thoughts\/list\/#[^"]+)"/)[1];
const accessToken = decodeURIComponent(accessUrl.split('#')[1]);

const approvedAgain = await call(request('/review', { method: 'POST', form: { token: approveUrl.searchParams.get('token') } }));
assert.match(await approvedAgain.text(), /已经同意过了/);
assert.equal(sent.at(-1), visitorMail);

const flipped = await call(request(new URL(rejectUrl).pathname + new URL(rejectUrl).search, { method: 'GET' }));
assert.match(await flipped.text(), /已经同意过了/);

const session = await call(request('/api/session', { method: 'POST', origin, body: { token: accessToken } }));
assert.equal(session.status, 200);
const cookie = session.headers.get('set-cookie');
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /Domain=\.kukudelin\.top/);
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
assert.match(sent2.at(-1).body.html, /这次先不打开/);
assert.doesNotMatch(sent2.at(-1).body.html, /thoughts\/list/);
const declinedAgain = await handle(request('/review', { method: 'POST', form: { token: rejectToken } }), env2, fetch2);
assert.match(await declinedAgain.text(), /已经拒绝过了/);
assert.equal(sent2.length, 2);

const stale = await signPayload(env.HMAC_SECRET, { action: 'approve', id: 'missing', exp: 1 });
const expired = await call(request(`/review?token=${encodeURIComponent(stale)}`));
assert.equal(expired.status, 410);

assert.match(reviewEmail({ answer: '<b>', email: 'a@b.co', approveUrl: 'https://example.com/a', rejectUrl: 'https://example.com/b' }), /&lt;b&gt;/);
assert.match(approveEmail({ accessUrl: 'https://kukudelin.top/thoughts/list/#abc' }), /abc/);
assert.match(declineEmail(), /林勇/);

console.log('thoughts worker tests ok');
