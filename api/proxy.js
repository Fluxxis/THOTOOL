import net from 'net';
import tls from 'tls';

// Proxy Checker (HTTP proxies, including auth)
// - No external deps
// - CONNECT tunnel for HTTPS targets
// - Absolute-form request for HTTP targets

const DEFAULT_TEST_URLS = [
  'https://api.ipify.org?format=json',
  'https://icanhazip.com/',
];

const TIMEOUT_MS = 6500;           // per step timeout
const MAX_BODY_BYTES = 96 * 1024;  // cap response body to keep serverless safe

function nowMs(){
  return Number(process.hrtime.bigint() / 1000000n);
}

function normalizeProxyInput(input){
  const s = String(input || '').trim();
  if(!s) return '';
  // Accept: host:port | user:pass@host:port | http://... | https://...
  if(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  return 'http://' + s;
}

function parseProxy(proxyInput){
  const url = new URL(normalizeProxyInput(proxyInput));

  // URL supports IPv6 in brackets, e.g. http://[::1]:3128
  const host = url.hostname;
  const port = Number(url.port || '8080');

  if(!host) throw new Error('Invalid proxy host');
  if(!Number.isFinite(port) || port < 1 || port > 65535) throw new Error('Invalid proxy port');

  let authHeader = '';
  if(url.username || url.password){
    const raw = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    authHeader = 'Proxy-Authorization: Basic ' + Buffer.from(raw).toString('base64') + '\r\n';
  }

  return { host, port, authHeader };
}

function parseTarget(targetUrl){
  const u = new URL(String(targetUrl));
  if(u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https supported');
  const host = u.hostname;
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  const path = (u.pathname || '/') + (u.search || '');
  return { u, host, port, path, isHttps: u.protocol === 'https:' };
}

function connectTcp(host, port, timeoutMs){
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Proxy TCP timeout'));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error('Proxy TCP error: ' + (err?.message || String(err))));
    });
  });
}

function writeAll(socket, data){
  return new Promise((resolve, reject) => {
    socket.write(data, (err) => {
      if(err) reject(err);
      else resolve();
    });
  });
}

function readUntil(socket, delimiter, timeoutMs){
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Read timeout'));
    }, timeoutMs);

    function onData(chunk){
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf(delimiter);
      if(idx !== -1){
        const head = buf.slice(0, idx + delimiter.length);
        const rest = buf.slice(idx + delimiter.length);
        cleanup();
        resolve({ head, rest });
      }
      if(buf.length > 256 * 1024){
        cleanup();
        reject(new Error('Headers too large'));
      }
    }

    function onErr(err){
      cleanup();
      reject(err);
    }

    function cleanup(){
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onErr);
      socket.off('end', onErr);
    }

    socket.on('data', onData);
    socket.once('error', onErr);
    socket.once('end', () => onErr(new Error('Socket ended')));
  });
}

function parseStatusAndHeaders(rawHeaderBuf){
  const text = rawHeaderBuf.toString('utf8');
  const lines = text.split('\r\n').filter(Boolean);
  const statusLine = lines.shift() || '';
  const m = statusLine.match(/HTTP\/\d\.\d\s+(\d{3})\s*(.*)/i);
  const statusCode = m ? Number(m[1]) : 0;
  const statusText = m ? (m[2] || '').trim() : '';
  const headers = {};
  for(const line of lines){
    const i = line.indexOf(':');
    if(i === -1) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    headers[k] = v;
  }
  return { statusCode, statusText, headers, statusLine };
}

async function doHttpViaProxy(proxy, target){
  // One TCP socket to proxy
  const t0 = nowMs();
  const socket = await connectTcp(proxy.host, proxy.port, TIMEOUT_MS);
  const t1 = nowMs();

  socket.setTimeout(TIMEOUT_MS, () => socket.destroy());

  // HTTP proxy: absolute-form request
  const req =
    `GET ${target.u.toString()} HTTP/1.1\r\n` +
    `Host: ${target.host}\r\n` +
    `${proxy.authHeader}` +
    `User-Agent: ToolsHub/ProxyChecker\r\n` +
    `Accept: */*\r\n` +
    `Accept-Encoding: identity\r\n` +
    `Connection: close\r\n\r\n`;

  await writeAll(socket, req);
  const { head, rest } = await readUntil(socket, Buffer.from('\r\n\r\n'), TIMEOUT_MS);
  const parsed = parseStatusAndHeaders(head);

  // read body (best-effort)
  let body = rest;
  await new Promise((resolve) => {
    socket.on('data', (chunk) => {
      if(body.length < MAX_BODY_BYTES){
        body = Buffer.concat([body, chunk.slice(0, Math.max(0, MAX_BODY_BYTES - body.length))]);
      }
    });
    socket.on('close', resolve);
    socket.on('end', resolve);
    socket.on('error', resolve);
  });

  const t2 = nowMs();
  return {
    ok: parsed.statusCode >= 200 && parsed.statusCode < 400,
    status_code: parsed.statusCode,
    status_text: parsed.statusText,
    connect_ms: t1 - t0,
    total_ms: t2 - t0,
    headers: parsed.headers,
    body_preview: body.toString('utf8').slice(0, 2000).trim(),
    bytes_read: body.length,
  };
}

async function doHttpsViaProxy(proxy, target){
  const t0 = nowMs();
  const socket = await connectTcp(proxy.host, proxy.port, TIMEOUT_MS);
  const t1 = nowMs();

  socket.setTimeout(TIMEOUT_MS, () => socket.destroy());

  // CONNECT tunnel
  const connectReq =
    `CONNECT ${target.host}:${target.port} HTTP/1.1\r\n` +
    `Host: ${target.host}:${target.port}\r\n` +
    `${proxy.authHeader}` +
    `Proxy-Connection: keep-alive\r\n` +
    `Connection: keep-alive\r\n\r\n`;

  await writeAll(socket, connectReq);
  const { head, rest } = await readUntil(socket, Buffer.from('\r\n\r\n'), TIMEOUT_MS);
  const parsed = parseStatusAndHeaders(head);

  if(parsed.statusCode !== 200){
    socket.destroy();
    return {
      ok: false,
      status_code: parsed.statusCode,
      status_text: parsed.statusText || 'CONNECT failed',
      connect_ms: t1 - t0,
      tunnel_ms: nowMs() - t1,
      total_ms: nowMs() - t0,
      bytes_read: 0,
      body_preview: '',
    };
  }

  const t2 = nowMs();

  // Upgrade to TLS over the established tunnel
  const tlsSocket = tls.connect({
    socket,
    servername: target.host,
    rejectUnauthorized: true, // keep TLS verification on
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error('TLS timeout'));
    }, TIMEOUT_MS);

    tlsSocket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve();
    });

    tlsSocket.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error('TLS error: ' + (err?.message || String(err))));
    });
  });

  // Send HTTPS request
  const req =
    `GET ${target.path} HTTP/1.1\r\n` +
    `Host: ${target.host}\r\n` +
    `User-Agent: ToolsHub/ProxyChecker\r\n` +
    `Accept: */*\r\n` +
    `Accept-Encoding: identity\r\n` +
    `Connection: close\r\n\r\n`;

  await writeAll(tlsSocket, req);

  // response headers
  const { head: h2, rest: r2 } = await readUntil(tlsSocket, Buffer.from('\r\n\r\n'), TIMEOUT_MS);
  const parsed2 = parseStatusAndHeaders(h2);

  let body = r2;
  await new Promise((resolve) => {
    tlsSocket.on('data', (chunk) => {
      if(body.length < MAX_BODY_BYTES){
        body = Buffer.concat([body, chunk.slice(0, Math.max(0, MAX_BODY_BYTES - body.length))]);
      }
    });
    tlsSocket.on('close', resolve);
    tlsSocket.on('end', resolve);
    tlsSocket.on('error', resolve);
  });

  const t3 = nowMs();

  return {
    ok: parsed2.statusCode >= 200 && parsed2.statusCode < 400,
    status_code: parsed2.statusCode,
    status_text: parsed2.statusText,
    connect_ms: t1 - t0,
    tunnel_ms: t2 - t1,
    tls_ms: t3 - t2,
    total_ms: t3 - t0,
    headers: parsed2.headers,
    body_preview: body.toString('utf8').slice(0, 2000).trim(),
    bytes_read: body.length,
  };
}

function extractExternalIp(bodyPreview){
  if(!bodyPreview) return '';
  const s = String(bodyPreview).trim();
  // JSON forms: {"ip":"x"} or {"origin":"x"}
  try{
    const j = JSON.parse(s);
    if(typeof j?.ip === 'string') return j.ip.trim();
    if(typeof j?.origin === 'string') return j.origin.trim();
  }catch{}
  // plain text ip
  const m = s.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return m ? m[1] : '';
}

export default async function handler(req, res){
  if(req.method !== 'GET'){
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  const proxyRaw = String(req.query.proxy || '').trim();
  const urlRaw = String(req.query.url || '').trim();

  if(!proxyRaw){
    return res.status(400).json({ ok:false, error:'Missing proxy parameter' });
  }

  let proxy;
  try{
    proxy = parseProxy(proxyRaw);
  }catch(e){
    return res.status(400).json({ ok:false, error: e.message || 'Invalid proxy' });
  }

  const testUrls = urlRaw ? [urlRaw] : DEFAULT_TEST_URLS;

  for(const testUrl of testUrls){
    try{
      const target = parseTarget(testUrl);
      const result = target.isHttps
        ? await doHttpsViaProxy(proxy, target)
        : await doHttpViaProxy(proxy, target);

      const externalIp = extractExternalIp(result.body_preview);

      return res.status(200).json({
        ok: true,
        data: {
          proxy: proxyRaw,
          working: !!result.ok,
          target_url: testUrl,
          external_ip: externalIp || undefined,
          status_code: result.status_code,
          status_text: result.status_text || undefined,
          latency_ms: result.total_ms,
          connect_ms: result.connect_ms,
          tunnel_ms: result.tunnel_ms,
          tls_ms: result.tls_ms,
          bytes_read: result.bytes_read,
          note: result.ok ? 'Proxy is working' : 'Proxy did not pass the check',
        }
      });

    }catch(e){
      // try next test url
      const msg = e?.message || String(e);
      // if this was the last attempt, return failure in a controlled, UI-friendly shape
      if(testUrl === testUrls[testUrls.length - 1]){
        return res.status(200).json({
          ok: true,
          data: {
            proxy: proxyRaw,
            working: false,
            target_url: testUrl,
            note: 'Proxy check failed',
            error: msg,
          }
        });
      }
    }
  }
}
