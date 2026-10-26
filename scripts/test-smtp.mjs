import assert from 'node:assert/strict';
import { buildMessage, encodeWord, sendSmtp, SmtpError } from '../worker/src/smtp.js';
import { createSmtpServer, parseMime } from './smtp-mock.mjs';

const base = {
  host: 'smtp.qq.com', port: 465, username: '3224688576@qq.com', password: 'secret-code',
  fromName: '林勇', fromAddress: '3224688576@qq.com', replyTo: '3224688576@qq.com',
  to: 'visitor@example.com', subject: '我想起你了', text: '纯文本\n.第二行以点开头', html: '<p>你好</p>',
  heloName: 'kukudelin.top', date: new Date('2026-10-26T09:30:00Z'), timeoutMs: 500,
};

// Encoded words stay ASCII, under 76 octets, and round-trip.
assert.equal(encodeWord('plain subject'), 'plain subject');
const long = encodeWord('关于你讲的那个瞬间'.repeat(4));
for (const word of long.split('\r\n ')) assert.ok(word.length <= 75 && /^[\x20-\x7e]+$/.test(word));
assert.equal(long.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString()), '关于你讲的那个瞬间'.repeat(4));

// Full conversation.
const server = createSmtpServer();
const result = await sendSmtp({ ...base, connect: server.connect });
const session = server.sessions[0];
assert.deepEqual(session.address, { hostname: 'smtp.qq.com', port: 465 });
assert.equal(session.options.secureTransport, 'on');
assert.deepEqual(session.commands.slice(0, 2), ['EHLO kukudelin.top', 'AUTH LOGIN']);
assert.equal(session.username, '3224688576@qq.com');
assert.equal(session.password, 'secret-code');
assert.ok(session.commands.includes('MAIL FROM:<3224688576@qq.com>'));
assert.ok(session.commands.includes('RCPT TO:<visitor@example.com>'));
assert.equal(session.commands.at(-1), 'QUIT');
assert.ok(session.closed);
const mime = parseMime(session.data);
assert.equal(mime.headers.from, '=?UTF-8?B?5p6X5YuH?= <3224688576@qq.com>');
assert.equal(mime.decoded.from, '林勇 <3224688576@qq.com>');
assert.equal(mime.decoded.replyTo, '林勇 <3224688576@qq.com>');
assert.equal(mime.decoded.subject, '我想起你了');
assert.match(mime.headers.subject, /^=\?UTF-8\?B\?/);
assert.equal(mime.headers.date, 'Mon, 26 Oct 2026 09:30:00 +0000');
assert.equal(mime.headers['message-id'], `<${result.messageId}>`);
assert.match(result.messageId, /^[0-9a-f-]{36}@qq\.com$/);
assert.equal(mime.headers['mime-version'], '1.0');
assert.match(mime.headers['content-type'], /^multipart\/alternative; boundary="/);
assert.equal(mime.parts['text/plain'], base.text);
assert.equal(mime.parts['text/html'], base.html);
assert.ok(session.data.split('\r\n').every((line) => line.length <= 998 && !line.startsWith('.')));
assert.match(buildMessage({ ...base, messageId: 'x@qq.com', boundary: 'b' }), /^From: .*\r\nReply-To: .*\r\nTo: <visitor@example\.com>\r\n/);

// Every failing step throws, closes the socket and never reports success.
for (const failAt of ['greeting', 'EHLO', 'AUTH', 'AUTH username', 'AUTH password', 'MAIL FROM', 'RCPT TO', 'DATA', 'message']) {
  const failing = createSmtpServer({ failAt });
  await assert.rejects(sendSmtp({ ...base, connect: failing.connect }), (error) => error instanceof SmtpError && !error.message.includes('secret-code'), failAt);
  assert.ok(failing.sessions[0].closed, failAt);
}
await assert.rejects(sendSmtp({ ...base, connect: createSmtpServer({ closeEarly: true }).connect }), /closed early/);
await assert.rejects(sendSmtp({ ...base, password: '', connect: createSmtpServer().connect }), /password is not configured/);
await assert.rejects(sendSmtp({ ...base, connect: undefined }), /socket is not available/);
await assert.rejects(sendSmtp({ ...base, to: 'bad\r\nRCPT TO:<x@y.z>', connect: createSmtpServer().connect }), /invalid email address/);
const silent = () => ({ readable: new ReadableStream(), writable: new WritableStream(), async close() {} });
await assert.rejects(sendSmtp({ ...base, connect: silent, timeoutMs: 50 }), /timed out/);

console.log('smtp tests ok');
