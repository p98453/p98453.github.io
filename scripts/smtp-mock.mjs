// A scripted SMTP server behind a fake Workers socket, for tests.
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function decodeWords(value) {
  return value.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
}

export function parseMime(data) {
  const [head, ...rest] = data.split('\r\n\r\n');
  const headers = {};
  for (const line of head.replace(/\r\n /g, ' ').split('\r\n')) {
    const at = line.indexOf(':');
    headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
  }
  const body = rest.join('\r\n\r\n');
  const boundary = headers['content-type'].match(/boundary="([^"]+)"/)[1];
  const parts = {};
  for (const chunk of body.split(`--${boundary}`).slice(1, -1)) {
    const [partHead, partBody] = chunk.replace(/^\r\n/, '').split('\r\n\r\n');
    const type = partHead.match(/Content-Type: ([^;]+)/)[1];
    parts[type] = Buffer.from(partBody.replace(/\r\n/g, ''), 'base64').toString('utf8');
  }
  return { headers, decoded: { from: decodeWords(headers.from), subject: decodeWords(headers.subject), replyTo: decodeWords(headers['reply-to'] || '') }, boundary, body, parts };
}

// failAt: an SMTP step name ("AUTH password", "RCPT TO", ...) to answer with an error.
export function createSmtpServer({ failAt, onMessage, closeEarly = false } = {}) {
  const sessions = [];
  const connect = (address, options) => {
    const session = { address, options, commands: [], closed: false };
    sessions.push(session);
    let controller;
    const readable = new ReadableStream({ start(c) { controller = c; } });
    const reply = (line) => controller.enqueue(encoder.encode(`${line}\r\n`));
    let inData = false;
    let data = '';
    let pending = '';
    let authStep = 0;
    let rcpt = null;
    const fail = (step, ok) => (failAt === step ? reply('535 Error: authentication failed') : reply(ok));
    const writable = new WritableStream({
      write(chunk) {
        pending += decoder.decode(chunk);
        if (inData) {
          data += pending;
          pending = '';
          if (data.endsWith('\r\n.\r\n')) {
            inData = false;
            const message = data.slice(0, -3);
            session.data = message;
            onMessage?.({ rcpt, data: message, session });
            fail('message', '250 OK: queued');
          }
          return;
        }
        let index;
        while ((index = pending.indexOf('\r\n')) >= 0) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 2);
          session.commands.push(line);
          if (closeEarly) { controller.close(); return; }
          if (authStep === 1) { authStep = 2; session.username = Buffer.from(line, 'base64').toString(); fail('AUTH username', '334 UGFzc3dvcmQ6'); continue; }
          if (authStep === 2) { authStep = 3; session.password = Buffer.from(line, 'base64').toString(); fail('AUTH password', '235 Authentication successful'); continue; }
          if (line.startsWith('EHLO')) { reply('250-smtp.mock'); reply('250-AUTH LOGIN PLAIN'); fail('EHLO', '250 8BITMIME'); }
          else if (line === 'AUTH LOGIN') { authStep = 1; fail('AUTH', '334 VXNlcm5hbWU6'); }
          else if (line.startsWith('MAIL FROM:')) fail('MAIL FROM', '250 OK');
          else if (line.startsWith('RCPT TO:')) { rcpt = line.slice(9, -1); fail('RCPT TO', '250 OK'); }
          else if (line === 'DATA') {
            if (failAt === 'DATA') { reply('554 no'); continue; }
            reply('354 End data with <CR><LF>.<CR><LF>');
            inData = true;
            data = pending;
            pending = '';
            if (data.endsWith('\r\n.\r\n')) { this.write(new Uint8Array()); }
          } else if (line === 'QUIT') reply('221 Bye');
          else reply('502 unknown');
        }
      },
    });
    queueMicrotask(() => (failAt === 'greeting' ? reply('554 go away') : reply('220 smtp.mock ESMTP')));
    return { readable, writable, async close() { session.closed = true; try { controller.close(); } catch {} } };
  };
  return { connect, sessions };
}
