import { sendSmtp } from './smtp.js';
import { APPROVE_SUBJECT, DECLINE_SUBJECT, ENTER_UNAVAILABLE, QUESTION, approveEmail, approveText, declineEmail, declineText, decisionPage, entryUrl, reviewEmail, reviewText } from './emails.js';

const ANSWER_MIN = 2;
const ANSWER_MAX = 2000;
const EMAIL_MAX = 254;
const IP_LIMIT = 5;
const EMAIL_DAY_LIMIT = 3;
const PASS_LIMIT = 5;
const PASS_WINDOW_MS = 10 * 60 * 1000;
const ENTER_IP_LIMIT = 5;
const ENTER_EMAIL_LIMIT = 5;
const ENTER_WINDOW_MS = 10 * 60 * 1000;
const ENTRY_LINK_MS = 7 * 24 * 60 * 60 * 1000;
const ENTRY_USED_TTL = 8 * 24 * 60 * 60;
const REVIEW_MS = 7 * 24 * 60 * 60 * 1000;
const REVOKE_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const SLUG = /^[a-z0-9-]{1,80}$/;
const ASSET = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const ASSET_MAX = 5 * 1024 * 1024;
const ASSET_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

function nowMs(env) {
  return typeof env.now === 'function' ? env.now() : Date.now();
}

function bytesToB64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function b64ToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function digestEqual(left, right) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

async function ownerPass(env, request, answer, now) {
  if (!env.OWNER_PASSPHRASE || !answer) return 'skip';
  const key = `rate:pass:${clientIp(request)}:${Math.floor(now / PASS_WINDOW_MS)}`;
  const tries = Number((await env.THOUGHTS.get(key)) || '0');
  if (tries >= PASS_LIMIT) return 'limited';
  if (await digestEqual(answer, env.OWNER_PASSPHRASE)) return 'ok';
  await env.THOUGHTS.put(key, String(tries + 1), { expirationTtl: 1200 });
  return 'skip';
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToB64(new Uint8Array(signature));
}

export async function signPayload(secret, payload) {
  const body = bytesToB64(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export function normalizeToken(raw) {
  let value = String(raw || '');
  for (let round = 0; round < 3 && /%[0-9a-fA-F]{2}/.test(value); round += 1) {
    try {
      value = decodeURIComponent(value);
    } catch {
      break;
    }
  }
  value = value.replace(/^token=/, '').replace(/&amp;/g, '&').split('&')[0];
  value = value.replace(/\s+/g, '').replaceAll('+', '-').replaceAll('/', '_').replace(/=+(?=\.|$)/g, '');
  return value.replace(/[^A-Za-z0-9_.-]+$/, '').replace(/^[^A-Za-z0-9_-]+/, '');
}

async function readPayload(secret, token, now, options = {}) {
  const parts = normalizeToken(token).split('.');
  if (parts.length !== 2 || !secret) return null;
  const [body, signature] = parts;
  const expected = await hmac(secret, body);
  if (!safeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64ToBytes(body)));
    if (!payload || typeof payload.exp !== 'number') return null;
    if (payload.exp < now) return options.keepExpired ? { ...payload, expired: true } : { expired: true };
    return payload;
  } catch {
    return null;
  }
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64(bytes);
}

function allowedOrigin(env) {
  return env.ALLOWED_ORIGIN || 'https://kukudelin.top';
}

function cors(env, request) {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  if (origin !== allowedOrigin(env)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  };
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function html(status, markup) {
  return new Response(markup, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '0.0.0.0';
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function cookieHeader(env, token, clear) {
  const parts = [
    `thoughts_session=${clear ? '' : encodeURIComponent(token)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${clear ? 0 : COOKIE_MAX_AGE}`,
  ];
  const host = env.WORKER_ORIGIN || '';
  if (host.includes('kukudelin.top')) parts.push('Domain=.kukudelin.top');
  return parts.join('; ');
}

function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  const match = raw.match(/(?:^|; )thoughts_session=([^;]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

async function readJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function limited(kv, key, limit, ttl) {
  const current = Number((await kv.get(key)) || '0');
  if (current >= limit) return true;
  await kv.put(key, String(current + 1), { expirationTtl: ttl });
  return false;
}

async function sendMail(env, fetchImpl, message) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM || !message.to) return false;
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    }),
  });
  return response.ok;
}

const QQ_SMTP_USER = '3224688576@qq.com';
const VISITOR_FROM_NAME = '林勇';

// Visitor mail goes out from the owner's own QQ mailbox so replies land there; failures are logged and reported, never hidden.
async function sendVisitorMail(env, deps, message) {
  try {
    await sendSmtp({
      connect: deps.connect,
      host: 'smtp.qq.com',
      port: 465,
      username: QQ_SMTP_USER,
      password: env.QQ_SMTP_PASS,
      fromName: VISITOR_FROM_NAME,
      fromAddress: QQ_SMTP_USER,
      replyTo: QQ_SMTP_USER,
      heloName: 'kukudelin.top',
      ...message,
    });
    return true;
  } catch (error) {
    console.error('visitor mail failed', error?.message || String(error));
    return false;
  }
}

function workerOrigin(env) {
  return (env.WORKER_ORIGIN || 'https://thoughts.kukudelin.top').replace(/\/$/, '');
}

function siteOrigin(env) {
  return (env.SITE_ORIGIN || 'https://kukudelin.top').replace(/\/$/, '');
}

async function reviewLinks(env, id, now) {
  const exp = now + REVIEW_MS;
  const approve = await signPayload(env.HMAC_SECRET, { action: 'approve', id, exp });
  const reject = await signPayload(env.HMAC_SECRET, { action: 'reject', id, exp });
  const origin = workerOrigin(env);
  return {
    approveUrl: `${origin}/review?token=${encodeURIComponent(approve)}`,
    rejectUrl: `${origin}/review?token=${encodeURIComponent(reject)}`,
  };
}

function authorized(env, request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Boolean(env.UPLOAD_TOKEN) && token.length > 0 && safeEqual(token, env.UPLOAD_TOKEN);
}

async function accessRecord(env, request) {
  const token = readCookie(request);
  if (!token) return null;
  const record = await readJson(env.THOUGHTS, `access:${token}`);
  if (!record || record.revoked) return null;
  return record;
}

async function apply(request, env, fetchImpl, headers) {
  let text = '';
  try {
    text = await request.text();
  } catch {
    return json(400, { error: 'invalid' }, headers);
  }
  if (text.length > 8000) return json(400, { error: 'invalid' }, headers);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'invalid' }, headers);
  }
  if (body.website) return json(200, { ok: true, status: 'pending' }, headers);

  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  const email = normalizeEmail(body.email);
  if (answer.length <= ANSWER_MAX) {
    const now = nowMs(env);
    const pass = await ownerPass(env, request, answer, now);
    if (pass === 'ok') {
      const token = randomToken();
      await env.THOUGHTS.put(`access:${token}`, JSON.stringify({ email: 'owner', appId: 'owner', createdAt: now, revoked: false }));
      return json(200, { ok: true, status: 'owner' }, { ...headers, 'set-cookie': cookieHeader(env, token, false) });
    }
    if (pass === 'limited' && !validEmail(email)) return json(429, { error: 'rate_limited' }, headers);
  }
  if (answer.length < ANSWER_MIN || answer.length > ANSWER_MAX || !validEmail(email)) {
    return json(400, { error: 'invalid' }, headers);
  }

  if (!env.OWNER_EMAIL || !env.HMAC_SECRET || !env.RESEND_API_KEY) {
    return json(503, { error: 'unconfigured' }, headers);
  }

  if (env.TURNSTILE_SECRET) {
    const form = new FormData();
    form.set('secret', env.TURNSTILE_SECRET);
    form.set('response', String(body.turnstile || ''));
    form.set('remoteip', clientIp(request));
    const check = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const verdict = await check.json().catch(() => ({}));
    if (!verdict.success) return json(400, { error: 'invalid' }, headers);
  }

  const now = nowMs(env);
  const ip = clientIp(request);
  const ipKey = `rate:ip:${ip}:${Math.floor(now / 3600000)}`;
  const mailKey = `rate:mail:${email}:${Math.floor(now / 86400000)}`;
  if (await limited(env.THOUGHTS, ipKey, IP_LIMIT, 7200) || await limited(env.THOUGHTS, mailKey, EMAIL_DAY_LIMIT, 172800)) {
    return json(429, { error: 'rate_limited' }, headers);
  }

  const previousId = await env.THOUGHTS.get(`email:${email}`);
  const previous = previousId ? await readJson(env.THOUGHTS, `apply:${previousId}`) : null;
  if (previous && previous.status === 'approved') {
    return json(200, { ok: true, status: 'pending' }, headers);
  }
  if (previous && previous.status === 'pending') {
    // Someone writing again while still waiting should reach the owner rather than vanish;
    // the per-email daily limit above keeps this from becoming a mail cannon.
    const links = await reviewLinks(env, previous.id, now);
    const mailed = await sendMail(env, fetchImpl, {
      to: env.OWNER_EMAIL,
      subject: '个人随想：有一份新的申请',
      html: reviewEmail({ answer, email, ...links }),
    text: reviewText({ answer, email, ...links }),
    });
    if (!mailed) return json(502, { error: 'network' }, headers);
    await env.THOUGHTS.put(`apply:${previous.id}`, JSON.stringify({ ...previous, answer, updatedAt: now }));
    return json(200, { ok: true, status: 'pending' }, headers);
  }

  const id = randomToken();
  const application = { id, answer, email, createdAt: now, status: 'pending' };
  const links = await reviewLinks(env, id, now);
  const mailed = await sendMail(env, fetchImpl, {
    to: env.OWNER_EMAIL,
    subject: '个人随想：有一份新的申请',
    html: reviewEmail({ answer, email, ...links }),
    text: reviewText({ answer, email, ...links }),
  });
  if (!mailed) return json(502, { error: 'network' }, headers);
  await env.THOUGHTS.put(`apply:${id}`, JSON.stringify(application));
  await env.THOUGHTS.put(`email:${email}`, id);
  return json(200, { ok: true, status: 'pending' }, headers);
}

async function session(request, env, headers) {
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json(400, { error: 'invalid' }, headers);
  }
  const token = typeof body.token === 'string' ? body.token : '';
  const record = token ? await readJson(env.THOUGHTS, `access:${token}`) : null;
  if (!record || record.revoked) return json(401, { error: 'unauthorized' }, headers);
  return json(200, { ok: true }, { ...headers, 'set-cookie': cookieHeader(env, token, false) });
}

function logout(env, headers) {
  return json(200, { ok: true }, { ...headers, 'set-cookie': cookieHeader(env, '', true) });
}

async function listThoughts(env, request, headers) {
  if (!(await accessRecord(env, request))) return json(401, { error: 'unauthorized' }, headers);
  const index = (await readJson(env.THOUGHTS, 'thoughts:index')) || [];
  const items = index.map((item) => ({ slug: item.slug, title: item.title, date: item.date }));
  return json(200, { items }, headers);
}

async function oneThought(env, request, slug, headers) {
  if (!SLUG.test(slug)) return json(404, { error: 'missing' }, headers);
  if (!(await accessRecord(env, request))) return json(401, { error: 'unauthorized' }, headers);
  const thought = await readJson(env.THOUGHTS, `thought:${slug}`);
  if (!thought) return json(404, { error: 'missing' }, headers);
  return json(200, {
    slug: thought.slug,
    title: thought.title,
    date: thought.date,
    tags: Array.isArray(thought.tags) ? thought.tags : [],
    markdown: thought.markdown,
  }, headers);
}

async function oneAsset(env, request, slug, name, headers) {
  if (!SLUG.test(slug) || !ASSET.test(name)) return json(404, { error: 'missing' }, headers);
  if (!(await accessRecord(env, request))) return json(401, { error: 'unauthorized' }, headers);
  const { value, metadata } = await env.THOUGHTS.getWithMetadata(`asset:${slug}:${name}`, { type: 'arrayBuffer' });
  if (!value) return json(404, { error: 'missing' }, headers);
  return new Response(value, {
    status: 200,
    headers: {
      ...headers,
      'content-type': metadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'cross-origin-resource-policy': 'same-site',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      vary: 'Cookie, Origin',
    },
  });
}

async function saveAsset(request, env, slug, name) {
  if (!authorized(env, request)) return json(401, { error: 'unauthorized' });
  if (!SLUG.test(slug) || !ASSET.test(name)) return json(400, { error: 'invalid' });
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ASSET_TYPES.has(contentType)) return json(415, { error: 'unsupported' });
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > ASSET_MAX) return json(413, { error: 'too large' });
  await env.THOUGHTS.put(`asset:${slug}:${name}`, body, { metadata: { contentType, size: body.byteLength } });
  return json(200, { ok: true, slug, name, size: body.byteLength });
}

async function saveThought(request, env) {
  if (!authorized(env, request)) return json(401, { error: 'unauthorized' });
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json(400, { error: 'invalid' });
  }
  const slug = String(body.slug || '');
  const title = String(body.title || '').trim();
  const date = String(body.date || '');
  const markdown = String(body.markdown || '');
  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20)
    : [];
  if (!SLUG.test(slug) || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !markdown || markdown.length > 100000) {
    return json(400, { error: 'invalid' });
  }
  await env.THOUGHTS.put(`thought:${slug}`, JSON.stringify({ slug, title, date, tags, markdown }));
  const index = (await readJson(env.THOUGHTS, 'thoughts:index')) || [];
  const next = index.filter((item) => item.slug !== slug);
  next.push({ slug, title, date });
  next.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? -1 : 1));
  await env.THOUGHTS.put('thoughts:index', JSON.stringify(next));
  return json(200, { ok: true, slug });
}

async function removeThought(request, env, slug) {
  if (!authorized(env, request)) return json(401, { error: 'unauthorized' });
  if (!SLUG.test(slug)) return json(400, { error: 'invalid' });
  await env.THOUGHTS.delete(`thought:${slug}`);
  let cursor;
  do {
    const page = await env.THOUGHTS.list({ prefix: `asset:${slug}:`, cursor });
    for (const key of page.keys) await env.THOUGHTS.delete(key.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const index = ((await readJson(env.THOUGHTS, 'thoughts:index')) || []).filter((item) => item.slug !== slug);
  await env.THOUGHTS.put('thoughts:index', JSON.stringify(index));
  return json(200, { ok: true });
}

async function showReview(env, token) {
  const payload = await readPayload(env.HMAC_SECRET, token, nowMs(env));
  if (!payload) return html(400, decisionPage({ heading: '链接无效', message: '这个链接签不出来，已经不能使用。' }));
  if (payload.expired) return html(410, decisionPage({ heading: '链接过期了', message: '这个链接已经过了有效期。如果还要处理，请让对方再提交一次。' }));
  if (payload.action === 'revoke') {
    return html(200, decisionPage({
      heading: '收回入口',
      message: '确认之后，这个人的入口会失效。已经打开的页面在下一次读取时也会进不去。',
      confirm: '确认收回',
      token: normalizeToken(token),
    }));
  }
  const application = await readJson(env.THOUGHTS, `apply:${payload.id}`);
  if (!application) return html(404, decisionPage({ heading: '没有找到申请', message: '这份申请不在记录里。' }));
  if (application.status !== 'pending') {
    const heading = application.status === 'approved' ? '已经同意过了' : '已经拒绝过了';
    const message = application.status === 'approved'
      ? '入口之前已经寄出，这次没有再寄一封。'
      : '回绝的信之前已经寄出，这次没有再寄一封。';
    return html(200, decisionPage({ heading, message }));
  }
  const verb = payload.action === 'approve' ? '同意' : '拒绝';
  const answer = application.answer.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br />');
  const safeEmail = application.email.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return html(200, decisionPage({
    heading: `确认${verb}`,
    message: `邮箱 ${safeEmail}。<br /><br />${answer}`,
    confirm: `确认${verb}`,
    token: normalizeToken(token),
  }));
}

function reviewOriginOk(env, request) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return true;
  return origin === workerOrigin(env);
}

async function reviewRoute(request, env, deps, url) {
  try {
    if (request.method === 'GET' || request.method === 'HEAD') return await showReview(env, url.searchParams.get('token'));
    if (request.method === 'POST') {
      if (!reviewOriginOk(env, request)) {
        return html(403, decisionPage({ heading: '无法确认', message: '这个确认不是从审核页发出的。请回到邮件里重新点开链接。' }));
      }
      return await actReview(request, env, deps, url);
    }
    return html(405, decisionPage({ heading: '打开方式不对', message: '请直接点邮件里的链接，在打开的页面上确认。' }));
  } catch {
    return html(500, decisionPage({ heading: '出了点问题', message: '这次没有处理成功，链接仍然有效，请稍后再点一次。' }));
  }
}

async function actReview(request, env, deps, url) {
  let token = '';
  try {
    const form = await request.formData();
    token = String(form.get('token') || '');
  } catch {
    token = '';
  }
  if (!token && url) token = url.searchParams.get('token') || '';
  const payload = await readPayload(env.HMAC_SECRET, token, nowMs(env));
  if (!payload) return html(400, decisionPage({ heading: '链接无效', message: '这个链接签不出来，已经不能使用。' }));
  if (payload.expired) {
    return html(410, decisionPage({ heading: '链接过期了', message: '这个链接已经过了有效期。如果还要处理，请让对方再提交一次。' }));
  }
  if (payload.action === 'revoke') return revoke(env, payload.id);
  const key = `apply:${payload.id}`;
  const application = await readJson(env.THOUGHTS, key);
  if (!application) return html(404, decisionPage({ heading: '没有找到申请', message: '这份申请不在记录里。' }));
  if (application.status !== 'pending') {
    const heading = application.status === 'approved' ? '已经同意过了' : '已经拒绝过了';
    return html(200, decisionPage({
      heading,
      message: application.status === 'approved' ? '入口之前已经寄出，这次没有再寄一封。' : '回绝的信之前已经寄出，这次没有再寄一封。',
    }));
  }
  if (payload.action === 'approve') return approve(env, deps, application);
  if (payload.action === 'reject') return reject(env, deps, application);
  return html(400, decisionPage({ heading: '链接无效', message: '这个链接不能识别。' }));
}

function redirect(location, extra = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      ...extra,
    },
  });
}

function gateLocation(env, email) {
  const url = new URL(`${siteOrigin(env)}/thoughts/`);
  url.searchParams.set('link', '1');
  if (validEmail(email)) url.searchParams.set('email', email);
  return url.toString();
}

function enterWindow(now) {
  return Math.floor(now / ENTER_WINDOW_MS);
}

async function enterLimited(kv, ip, email, now) {
  const windowId = enterWindow(now);
  const ipKey = `rate:enter:ip:${ip}:${windowId}`;
  const mailKey = `rate:enter:mail:${email}:${windowId}`;
  const ipCount = Number((await kv.get(ipKey)) || '0');
  const mailCount = Number((await kv.get(mailKey)) || '0');
  if (ipCount >= ENTER_IP_LIMIT || mailCount >= ENTER_EMAIL_LIMIT) return true;
  await kv.put(ipKey, String(ipCount + 1), { expirationTtl: 1200 });
  await kv.put(mailKey, String(mailCount + 1), { expirationTtl: 1200 });
  return false;
}

async function ipEnterLimited(kv, ip, now) {
  const key = `rate:enter:ip:${ip}:${enterWindow(now)}`;
  const count = Number((await kv.get(key)) || '0');
  if (count >= ENTER_IP_LIMIT) return true;
  await kv.put(key, String(count + 1), { expirationTtl: 1200 });
  return false;
}

// Unknown, pending, rejected, and revoked addresses all take these three reads.
async function approvedAccessToken(env, email) {
  const id = (await env.THOUGHTS.get(`email:${email}`)) || '';
  const application = await readJson(env.THOUGHTS, `apply:${id || '_'}`);
  const accessToken = application?.accessToken || '';
  const access = await readJson(env.THOUGHTS, `access:${accessToken || '_'}`);
  if (
    !id
    || !application
    || application.status !== 'approved'
    || application.email !== email
    || !accessToken
    || !access
    || access.revoked
  ) return '';
  return accessToken;
}

async function enterByEmail(request, env, headers) {
  let body;
  try {
    const text = await request.text();
    if (text.length > 2000) return json(400, { error: 'invalid' }, headers);
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'invalid' }, headers);
  }
  const email = normalizeEmail(body?.email);
  const now = nowMs(env);
  const ip = clientIp(request);
  if (!validEmail(email)) {
    if (await ipEnterLimited(env.THOUGHTS, ip, now)) return json(429, { error: 'rate_limited' }, headers);
    return json(400, { error: 'invalid' }, headers);
  }
  if (await enterLimited(env.THOUGHTS, ip, email, now)) return json(429, { error: 'rate_limited' }, headers);
  const accessToken = await approvedAccessToken(env, email);
  if (!accessToken) return json(200, { ok: false, message: ENTER_UNAVAILABLE }, headers);
  return json(200, { ok: true, status: 'granted' }, {
    ...headers,
    'set-cookie': cookieHeader(env, accessToken, false),
  });
}

function entryJti(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

async function openEntryLink(request, env, url) {
  if (request.method !== 'GET') return redirect(gateLocation(env));
  const payload = await readPayload(env.HMAC_SECRET, url.searchParams.get('token') || '', nowMs(env), { keepExpired: true });
  const email = payload?.action === 'enter' && validEmail(payload.email) ? payload.email : '';
  if (!payload || payload.action !== 'enter' || !entryJti(payload.jti) || !email) return redirect(gateLocation(env));
  if (payload.expired) return redirect(gateLocation(env, email));

  const usedKey = `enter-used:${payload.jti}`;
  if (await env.THOUGHTS.get(usedKey)) return redirect(gateLocation(env, email));

  const application = await readJson(env.THOUGHTS, `apply:${payload.id}`);
  const access = application?.accessToken ? await readJson(env.THOUGHTS, `access:${application.accessToken}`) : null;
  if (
    !application
    || application.status !== 'approved'
    || application.email !== email
    || !access
    || access.revoked
  ) {
    return redirect(gateLocation(env, email));
  }

  await env.THOUGHTS.put(usedKey, '1', { expirationTtl: ENTRY_USED_TTL });
  return redirect(`${siteOrigin(env)}/thoughts/list/`, {
    'set-cookie': cookieHeader(env, application.accessToken, false),
  });
}

async function enterByLink(request, env, url) {
  try {
    return await openEntryLink(request, env, url);
  } catch {
    return redirect(gateLocation(env));
  }
}

async function approve(env, deps, application) {
  const token = randomToken();
  const now = nowMs(env);
  const entryToken = await signPayload(env.HMAC_SECRET, {
    action: 'enter',
    id: application.id,
    email: application.email,
    jti: randomToken(),
    exp: now + ENTRY_LINK_MS,
  });
  const accessUrl = entryUrl(workerOrigin(env), entryToken);
  const mailed = await sendVisitorMail(env, deps, {
    to: application.email,
    subject: APPROVE_SUBJECT,
    html: approveEmail({ accessUrl }),
    text: approveText({ accessUrl }),
  });
  if (!mailed) return html(502, decisionPage({ heading: '信没有送出', message: '入口还没有寄出。链接仍然有效，可以稍后再确认一次。' }));
  await env.THOUGHTS.put(`access:${token}`, JSON.stringify({
    email: application.email,
    appId: application.id,
    createdAt: now,
    revoked: false,
  }));
  application.status = 'approved';
  application.accessToken = token;
  application.decidedAt = now;
  await env.THOUGHTS.put(`apply:${application.id}`, JSON.stringify(application));
  const revokeToken = await signPayload(env.HMAC_SECRET, { action: 'revoke', id: application.id, exp: now + REVOKE_MS });
  const revokeUrl = `${workerOrigin(env)}/review?token=${encodeURIComponent(revokeToken)}`;
  const safeEmail = application.email.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return html(200, decisionPage({
    heading: '已同意',
    message: `入口已经寄到 ${safeEmail}。若要收回，打开 <a href="${revokeUrl}">收回入口</a>。`,
  }));
}

async function reject(env, deps, application) {
  const mailed = await sendVisitorMail(env, deps, {
    to: application.email,
    subject: DECLINE_SUBJECT,
    html: declineEmail(),
    text: declineText(),
  });
  if (!mailed) return html(502, decisionPage({ heading: '信没有送出', message: '回绝的信还没有寄出。链接仍然有效，可以稍后再确认一次。' }));
  application.status = 'rejected';
  application.decidedAt = nowMs(env);
  await env.THOUGHTS.put(`apply:${application.id}`, JSON.stringify(application));
  return html(200, decisionPage({ heading: '已拒绝', message: '一封短信已经寄给对方。' }));
}

async function revoke(env, appId) {
  const application = await readJson(env.THOUGHTS, `apply:${appId}`);
  if (!application || !application.accessToken) {
    return html(200, decisionPage({ heading: '没有可收回的入口', message: '这份申请还没有发出入口。' }));
  }
  const record = await readJson(env.THOUGHTS, `access:${application.accessToken}`);
  if (record?.revoked) {
    return html(200, decisionPage({ heading: '已经收回', message: '这个入口之前就失效了，没有重复处理。' }));
  }
  if (record) {
    record.revoked = true;
    await env.THOUGHTS.put(`access:${application.accessToken}`, JSON.stringify(record));
  }
  return html(200, decisionPage({ heading: '已收回', message: '这个入口已经失效。' }));
}

export async function handle(request, env, fetchImpl = fetch, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path.startsWith('/admin')) {
    if (request.headers.get('origin')) return json(403, { error: 'forbidden' });
    if (request.method === 'PUT' && path === '/admin/thoughts') return saveThought(request, env);
    const assetPut = /^\/admin\/thoughts\/([^/]+)\/assets\/([^/]+)$/.exec(path);
    if (request.method === 'PUT' && assetPut) {
      return saveAsset(request, env, decodeURIComponent(assetPut[1]), decodeURIComponent(assetPut[2]));
    }
    const slug = path.startsWith('/admin/thoughts/') ? path.slice('/admin/thoughts/'.length) : '';
    if (request.method === 'DELETE' && slug) return removeThought(request, env, decodeURIComponent(slug));
    return json(404, { error: 'missing' });
  }

  if (path === '/review') return reviewRoute(request, env, deps, url);
  if (path === '/enter') return enterByLink(request, env, url);

  if (request.method === 'OPTIONS') {
    const headers = cors(env, request);
    if (!headers) return json(403, { error: 'forbidden' });
    return new Response(null, { status: 204, headers });
  }

  const headers = cors(env, request);
  if (!headers) return json(403, { error: 'forbidden' });

  if (request.method === 'POST' && path === '/api/apply') return apply(request, env, fetchImpl, headers);
  if (request.method === 'POST' && path === '/api/enter') return enterByEmail(request, env, headers);
  if (request.method === 'POST' && path === '/api/session') return session(request, env, headers);
  if (request.method === 'POST' && path === '/api/logout') return logout(env, headers);
  if (request.method === 'GET' && path === '/api/thoughts') return listThoughts(env, request, headers);
  const assetGet = /^\/api\/thoughts\/([^/]+)\/assets\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && assetGet) {
    return oneAsset(env, request, decodeURIComponent(assetGet[1]), decodeURIComponent(assetGet[2]), headers);
  }
  if (request.method === 'GET' && path.startsWith('/api/thoughts/')) {
    return oneThought(env, request, decodeURIComponent(path.slice('/api/thoughts/'.length)), headers);
  }
  return json(404, { error: 'missing' }, headers);
}

export { QUESTION };
