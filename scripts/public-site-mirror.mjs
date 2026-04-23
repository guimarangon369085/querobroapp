import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const LISTEN_HOST = process.env.QBAPP_PUBLIC_MIRROR_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.QBAPP_PUBLIC_MIRROR_PORT || '3000');
const TARGET_ORIGIN = String(process.env.QBAPP_PUBLIC_MIRROR_TARGET || 'https://querobroa.com.br')
  .trim()
  .replace(/\/+$/, '');

if (!/^https?:\/\//i.test(TARGET_ORIGIN)) {
  throw new Error(`QBAPP_PUBLIC_MIRROR_TARGET invalido: ${TARGET_ORIGIN}`);
}

const targetUrl = new URL(TARGET_ORIGIN);
const localOrigin = `http://${LISTEN_HOST}:${LISTEN_PORT}`;
const mirrorModeBannerHtml =
  '<div data-qbapp-public-mirror-banner style="position:sticky;top:0;z-index:2147483647;padding:10px 14px;background:#2f4a44;color:#f8f1e7;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;box-shadow:0 10px 24px rgba(18,27,25,.18)">Espelho visual do publicado · scripts interativos desativados no local para evitar drift de origem</div>';

function rewriteLocationHeader(value) {
  if (!value) return value;

  try {
    const url = new URL(value, TARGET_ORIGIN);
    if (url.origin !== targetUrl.origin) return value;
    return `${localOrigin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function rewriteSetCookieHeader(value) {
  if (!value) return value;

  return value
    .replace(/;\s*Domain=[^;]+/gi, '')
    .replace(/;\s*Secure/gi, '');
}

function stripInteractiveScriptsFromHtml(html) {
  const source = String(html || '');
  if (!source) return source;

  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  if (withoutScripts.includes('data-qbapp-public-mirror-banner')) {
    return withoutScripts;
  }

  if (/<body\b[^>]*>/i.test(withoutScripts)) {
    return withoutScripts.replace(/<body\b([^>]*)>/i, `<body$1>${mirrorModeBannerHtml}`);
  }

  return `${mirrorModeBannerHtml}${withoutScripts}`;
}

function copyRequestHeaders(req) {
  const headers = new Headers();

  for (const [rawKey, rawValue] of Object.entries(req.headers)) {
    if (rawValue == null) continue;
    const key = rawKey.toLowerCase();
    if (key === 'host' || key === 'content-length' || key === 'connection') continue;

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) headers.append(key, item);
      continue;
    }

    headers.set(key, rawValue);
  }

  headers.set('host', targetUrl.host);
  headers.set('x-forwarded-host', req.headers.host || `${LISTEN_HOST}:${LISTEN_PORT}`);
  headers.set('x-forwarded-proto', 'http');
  return headers;
}

function copyResponseHeaders(upstreamResponse, responseHeaders) {
  upstreamResponse.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'content-length') return;
    if (normalizedKey === 'location') {
      responseHeaders.set(key, rewriteLocationHeader(value));
      return;
    }
    responseHeaders.set(key, value);
  });

  if (typeof upstreamResponse.headers.getSetCookie === 'function') {
    const cookies = upstreamResponse.headers.getSetCookie();
    if (cookies.length > 0) {
      responseHeaders.delete('set-cookie');
      for (const cookie of cookies) {
        responseHeaders.append('set-cookie', rewriteSetCookieHeader(cookie));
      }
    }
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url || '/';
  const upstreamUrl = new URL(pathname, TARGET_ORIGIN);
  const method = req.method || 'GET';
  const headers = copyRequestHeaders(req);
  const requestInit = {
    method,
    headers,
    redirect: 'manual'
  };

  if (method !== 'GET' && method !== 'HEAD') {
    requestInit.body = Readable.toWeb(req);
    requestInit.duplex = 'half';
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, requestInit);
    const responseHeaders = {};
    copyResponseHeaders(upstreamResponse, {
      set(name, value) {
        responseHeaders[name] = value;
      },
      append(name, value) {
        const current = responseHeaders[name];
        if (current == null) {
          responseHeaders[name] = value;
        } else if (Array.isArray(current)) {
          current.push(value);
        } else {
          responseHeaders[name] = [current, value];
        }
      },
      delete(name) {
        delete responseHeaders[name];
      }
    });

    const contentType = String(upstreamResponse.headers.get('content-type') || '').toLowerCase();
    const shouldServeStaticHtml =
      method === 'GET' &&
      contentType.includes('text/html') &&
      !pathname.startsWith('/_next/') &&
      !pathname.startsWith('/api/');

    if (shouldServeStaticHtml) {
      const html = await upstreamResponse.text();
      const rewrittenHtml = stripInteractiveScriptsFromHtml(html);
      responseHeaders['content-length'] = Buffer.byteLength(rewrittenHtml, 'utf8');
      res.writeHead(upstreamResponse.status, responseHeaders);
      res.end(rewrittenHtml);
      return;
    }

    res.writeHead(upstreamResponse.status, responseHeaders);

    if (!upstreamResponse.body || method === 'HEAD') {
      res.end();
      return;
    }

    Readable.fromWeb(upstreamResponse.body).pipe(res);
  } catch (error) {
    const message =
      error instanceof Error
        ? `Falha ao espelhar ${upstreamUrl.toString()}: ${error.message}`
        : `Falha ao espelhar ${upstreamUrl.toString()}.`;
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message }));
  }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    JSON.stringify({
      mode: 'public-site-mirror',
      listenHost: LISTEN_HOST,
      listenPort: LISTEN_PORT,
      targetOrigin: TARGET_ORIGIN
    })
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
