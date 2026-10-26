export const ASK_LEAD = '讲一件和我有关的小事，';
export const ASK_TAIL = '我想想认不认识你。';
export const QUESTION = `${ASK_LEAD}${ASK_TAIL}`;

export const ENTER_UNAVAILABLE = '这个邮箱暂时进不来。可以先提交申请，或者过会儿再试。';

export function entryUrl(origin, token) {
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}/enter?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:#fff;color:#1b3156;font-family:Georgia,'Noto Serif SC','Songti SC',serif;">
  <div style="max-width:560px;margin:0 auto;padding:48px 28px 64px;">
    ${body}
  </div>
</body>
</html>`;
}

export function reviewEmail({ answer, email, approveUrl, rejectUrl }) {
  const safeAnswer = escapeHtml(answer).replaceAll('\n', '<br />');
  return page('有人申请进入个人随想', `
    <p style="letter-spacing:0.12em;color:#7b8894;font-size:13px;">个人随想</p>
    <h1 style="font-weight:500;font-size:28px;margin:8px 0 18px;">有人想进来</h1>
    <p style="line-height:1.8;color:#1b3156;">${escapeHtml(QUESTION)}</p>
    <blockquote style="margin:22px 0;padding:8px 0 8px 16px;border-left:2px solid #adbac7;line-height:1.85;color:#000;">${safeAnswer}</blockquote>
    <p style="line-height:1.8;">对方的邮箱：<a href="mailto:${escapeHtml(email)}" style="color:#115ca1;">${escapeHtml(email)}</a></p>
    <p style="margin-top:28px;">
      <a href="${escapeHtml(approveUrl)}" style="display:inline-block;margin:0 12px 12px 0;padding:8px 18px;border:1px solid #115ca1;color:#115ca1;text-decoration:none;">同意</a>
      <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;margin:0 0 12px;padding:8px 18px;border:1px solid #adbac7;color:#1b3156;text-decoration:none;">拒绝</a>
    </p>
    <p style="color:#7b8894;font-size:14px;line-height:1.7;">这两个链接七天内有效。打开后还需要再确认一次，避免邮箱自动预览把决定点掉。</p>
  `);
}

export function reviewText({ answer, email, approveUrl, rejectUrl }) {
  const quoted = String(answer).split('\n').map((line) => `> ${line}`).join('\n');
  return `个人随想\n\n有人想进来\n\n${QUESTION}\n\n${quoted}\n\n对方的邮箱：${email}\n\n同意：${approveUrl}\n\n拒绝：${rejectUrl}\n\n这两个链接七天内有效。打开后还需要再确认一次，避免邮箱自动预览把决定点掉。\n`;
}

export const APPROVE_SUBJECT = '我想起你了';
export const DECLINE_SUBJECT = '关于你讲的那个瞬间';

const APPROVE_BODY = '谢谢你讲的那个瞬间，我回忆了很久，入口已经为你打开了，点下面的链接就能进来。里面都是些零碎的日常和想法，谢谢你愿意了解真实的我。';
const APPROVE_NOTE = '这个链接只属于你，请别转给别人。七天内点开一次就能进来；如果打不开了，回到页面填邮箱也行。';
const DECLINE_BODY = '谢谢你愿意停下来，讲一个和我有关的瞬间。这一次，我还没能想起你是谁，所以入口暂时没为你打开。也许是时间隔得太久，也许我们只是还不够熟。如果哪天你想起了更具体的片段，欢迎回来。';
const SIGNATURE = '—— 小牛';

export function approveEmail({ accessUrl }) {
  return page(APPROVE_SUBJECT, `
    <p style="letter-spacing:0.12em;color:#7b8894;font-size:13px;">个人随想</p>
    <h1 style="font-weight:500;font-size:28px;margin:8px 0 18px;">${APPROVE_SUBJECT}</h1>
    <p style="line-height:1.9;color:#000;">${APPROVE_BODY}</p>
    <p style="margin:28px 0;">
      <a href="${escapeHtml(accessUrl)}" style="display:inline-block;padding:8px 18px;border:1px solid #115ca1;color:#115ca1;text-decoration:none;">进入个人随想</a>
    </p>
    <p style="line-height:1.9;color:#7b8894;font-size:14px;">${APPROVE_NOTE}</p>
    <p style="line-height:1.9;color:#1b3156;margin-top:28px;">${SIGNATURE}</p>
  `);
}

export function approveText({ accessUrl }) {
  return `个人随想\n\n${APPROVE_SUBJECT}\n\n${APPROVE_BODY}\n\n进入个人随想：${accessUrl}\n\n${APPROVE_NOTE}\n\n${SIGNATURE}\n`;
}

export function declineEmail() {
  return page(DECLINE_SUBJECT, `
    <p style="letter-spacing:0.12em;color:#7b8894;font-size:13px;">个人随想</p>
    <h1 style="font-weight:500;font-size:28px;margin:8px 0 18px;">${DECLINE_SUBJECT}</h1>
    <p style="line-height:1.9;color:#000;">${DECLINE_BODY}</p>
    <p style="line-height:1.9;color:#1b3156;margin-top:28px;">${SIGNATURE}</p>
  `);
}

export function declineText() {
  return `个人随想\n\n${DECLINE_SUBJECT}\n\n${DECLINE_BODY}\n\n${SIGNATURE}\n`;
}
export function decisionPage({ heading, message, confirm, token }) {
  const form = confirm
    ? `<form method="post" action="/review" style="margin-top:28px;">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit" style="font:inherit;padding:8px 18px;border:1px solid #115ca1;background:#fff;color:#115ca1;cursor:pointer;">${escapeHtml(confirm)}</button>
      </form>`
    : '';
  return page(heading, `
    <p style="letter-spacing:0.12em;color:#7b8894;font-size:13px;">个人随想</p>
    <h1 style="font-weight:500;font-size:28px;margin:8px 0 18px;">${escapeHtml(heading)}</h1>
    <p style="line-height:1.9;color:#000;">${message}</p>
    ${form}
  `);
}
