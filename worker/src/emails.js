export const QUESTION = '要是能回到某个和我有关的瞬间，你会选哪一个？';

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

export function approveEmail({ accessUrl }) {
  return page('个人随想的入口', `
    <p style="letter-spacing:0.12em;color:#7b8894;font-size:13px;">个人随想</p>
    <h1 style="font-weight:500;font-size:28px;margin:8px 0 18px;">门开了一条缝</h1>
    <p style="line-height:1.9;color:#000;">你写下的那个瞬间，我留下了。</p>
    <p style="line-height:1.9;color:#000;">下面这扇门只为你开。它不公开，也可以随时收回，请不要转给别人。</p>
    <p style="margin:28px 0;">
      <a href="${escapeHtml(accessUrl)}" style="display:inline-block;padding:8px 18px;border:1px solid #115ca1;color:#115ca1;text-decoration:none;">进入个人随想</a>
    </p>
    <p style="line-height:1.9;color:#1b3156;">林勇</p>
  `);
}

export function declineEmail() {
  return page('关于个人随想', `
    <p style="letter-spacing:0.12em;color:#7b8894;font-size:13px;">个人随想</p>
    <h1 style="font-weight:500;font-size:28px;margin:8px 0 18px;">这次先不打开</h1>
    <p style="line-height:1.9;color:#000;">谢谢你愿意把一个和我有关的瞬间写下来。我读过了。</p>
    <p style="line-height:1.9;color:#000;">这些文字我留得很小，一次只请很少的人进来。这一次我没有把入口留下。不是因为那句话不好，只是它还不是这扇门想打开的理由。</p>
    <p style="line-height:1.9;color:#000;">如果你以后还想写，门还在原来的地方。慢慢来就好。</p>
    <p style="line-height:1.9;color:#1b3156;">林勇</p>
  `);
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
