// A minimal SMTP client for Workers sockets: implicit TLS, AUTH LOGIN, one recipient, multipart/alternative.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SmtpError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SmtpError';
    this.code = code;
  }
}

function base64(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function wrap(value, width = 76) {
  return value.match(new RegExp(`.{1,${width}}`, 'g'))?.join('\r\n') || '';
}

// RFC 2047 encoded-word; split on whole characters so no word exceeds 75 octets.
export function encodeWord(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words = [];
  let chunk = '';
  for (const char of value) {
    if (encoder.encode(chunk + char).length > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(word)}?=`).join('\r\n ');
}

function assertAddress(address) {
  if (!/^[^\s<>@,;:"]+@[^\s<>@,;:"]+$/.test(address)) throw new SmtpError('invalid email address');
  return address;
}

export function buildMessage({ fromName, fromAddress, replyTo, to, subject, text, html, date = new Date(), messageId, boundary }) {
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(body)),
  ].join('\r\n');
  return [
    `From: ${encodeWord(fromName)} <${fromAddress}>`,
    ...(replyTo ? [`Reply-To: ${encodeWord(fromName)} <${replyTo}>`] : []),
    `To: <${to}>`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', text),
    part('text/html', html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

class Conversation {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buffer = '';
    this.timeoutMs = timeoutMs;
  }

  async readReply() {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const lines = this.buffer.split('\r\n');
      for (let i = 0; i < lines.length - 1; i += 1) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const text = lines.slice(0, i + 1).join('\n');
          this.buffer = lines.slice(i + 1).join('\r\n');
          return { code: Number(lines[i].slice(0, 3)), text };
        }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SmtpError('SMTP server timed out');
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new SmtpError('SMTP server timed out')), remaining); });
      const { value, done } = await Promise.race([this.reader.read(), timeout]).finally(() => clearTimeout(timer));
      if (done) throw new SmtpError('SMTP connection closed early');
      this.buffer += decoder.decode(value, { stream: true });
    }
  }

  async expect(codes, step) {
    const reply = await this.readReply();
    if (!codes.includes(reply.code)) throw new SmtpError(`SMTP ${step} failed: ${reply.text.split('\n')[0]}`, reply.code);
    return reply;
  }

  async send(line, codes, step) {
    await this.writer.write(encoder.encode(`${line}\r\n`));
    return this.expect(codes, step);
  }
}

export async function sendSmtp(options) {
  const {
    connect, host, port = 465, username, password, fromName, fromAddress = username, replyTo,
    to, subject, text, html, heloName = 'localhost', timeoutMs = 15000, date = new Date(),
  } = options;
  if (typeof connect !== 'function') throw new SmtpError('SMTP socket is not available');
  if (!password) throw new SmtpError('SMTP password is not configured');
  assertAddress(username);
  assertAddress(fromAddress);
  assertAddress(to);
  if (replyTo) assertAddress(replyTo);
  const id = crypto.randomUUID();
  const domain = fromAddress.split('@')[1];
  const data = buildMessage({ fromName, fromAddress, replyTo, to, subject, text, html, date, messageId: `${id}@${domain}`, boundary: `=_alt_${id}` });
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const smtp = new Conversation(socket, timeoutMs);
  try {
    await smtp.expect([220], 'greeting');
    await smtp.send(`EHLO ${heloName}`, [250], 'EHLO');
    await smtp.send('AUTH LOGIN', [334], 'AUTH');
    await smtp.send(base64(username), [334], 'AUTH username');
    await smtp.send(base64(password), [235], 'AUTH password');
    await smtp.send(`MAIL FROM:<${fromAddress}>`, [250], 'MAIL FROM');
    await smtp.send(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await smtp.send('DATA', [354], 'DATA');
    // Every body line is base64 or a header, so no line starts with "."; the terminator ends the message.
    await smtp.send(`${data}.`, [250], 'message');
    try {
      await smtp.writer.write(encoder.encode('QUIT\r\n'));
    } catch {
      // The message is accepted; a failed goodbye does not matter.
    }
    return { messageId: `${id}@${domain}` };
  } finally {
    try {
      await socket.close();
    } catch {
      // Already closed.
    }
  }
}
