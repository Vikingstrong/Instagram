import { createServer, type Socket } from 'node:net';

// Test-only, loopback-bound SMTP receiver. No container, HTTP mailbox or external
// delivery; the production app never imports this module or exposes mail tokens.
export async function startTestSmtp() {
  const messages: { to: string[]; raw: string; text: string }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.write('220 test.local ESMTP\r\n');
    let buffer = '',
      data = false,
      body: string[] = [],
      recipients: string[] = [];
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 512 * 1024) {
        socket.destroy();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (data) {
          if (line !== '.') {
            body.push(line.startsWith('..') ? line.slice(1) : line);
            continue;
          }
          const raw = body.join('\n');
          const split = raw.indexOf('\n\n');
          const headers = raw.slice(0, split),
            payload = raw.slice(split + 2);
          const text = /Content-Transfer-Encoding:\s*base64/i.test(headers)
            ? Buffer.from(payload.replace(/\s/g, ''), 'base64').toString('utf8')
            : payload
                .replace(/=\r?\n/g, '')
                .replace(/=([0-9a-f]{2})/gi, (_, hex: string) =>
                  String.fromCharCode(parseInt(hex, 16)),
                );

          messages.push({ to: [...recipients], raw, text });
          data = false;
          body = [];
          recipients = [];
          socket.write('250 delivered\r\n');
          continue;
        }
        if (/^EHLO|^HELO/i.test(line))
          socket.write('250-test.local\r\n250 SIZE 262144\r\n');
        else if (/^MAIL FROM:/i.test(line)) {
          recipients = [];
          socket.write('250 OK\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          const address = /<([^>]+)>/.exec(line)?.[1];
          if (address) recipients.push(address);
          socket.write('250 OK\r\n');
        } else if (/^DATA$/i.test(line)) {
          data = true;
          body = [];
          socket.write('354 End with dot\r\n');
        } else if (/^QUIT$/i.test(line)) {
          socket.end('221 Bye\r\n');
        } else if (/^RSET|^NOOP/i.test(line)) socket.write('250 OK\r\n');
        else socket.write('502 Unsupported\r\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local SMTP address');
  return {
    port: address.port,
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
