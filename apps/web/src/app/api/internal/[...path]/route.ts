import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

function buildUpstreamUrl(request: Request, path: string[]) {
  const requestUrl = new URL(request.url);
  const baseUrl = resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL);
  const pathname = path.map((segment) => encodeURIComponent(segment)).join('/');
  const upstreamUrl = new URL(`${baseUrl}/${pathname}`);
  upstreamUrl.search = requestUrl.search;
  return upstreamUrl;
}

function buildUpstreamHeaders(request: Request) {
  const headers = new Headers();
  const appToken = String(process.env.APP_API_BRIDGE_TOKEN || process.env.APP_AUTH_TOKEN || '').trim();
  if (appToken) {
    headers.set('x-app-token', appToken);
  }

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }

  const accept = request.headers.get('accept');
  if (accept) {
    headers.set('accept', accept);
  }

  const xRequestId = request.headers.get('x-request-id');
  if (xRequestId) {
    headers.set('x-request-id', xRequestId);
  }

  return headers;
}

async function proxyRequest(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return buildErrorResponse(405, { message: 'Metodo nao suportado pelo bridge interno.' });
  }

  const params = await context.params;
  const path = Array.isArray(params.path) ? params.path.filter(Boolean) : [];
  if (!path.length) {
    return buildErrorResponse(404, { message: 'Rota interna nao encontrada.' });
  }

  const upstreamUrl = buildUpstreamUrl(request, path);
  const headers = buildUpstreamHeaders(request);
  const requestInit: RequestInit = {
    method,
    headers,
    cache: 'no-store'
  };

  if (method !== 'GET' && method !== 'DELETE') {
    requestInit.body = Buffer.from(await request.arrayBuffer());
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, requestInit);
    const responseHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
      responseHeaders.set(key, value);
    });

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders
    });
  } catch (error) {
    return buildErrorResponse(502, {
      message:
        error instanceof Error
          ? `Falha ao conectar o bridge interno com a API: ${error.message}`
          : 'Falha ao conectar o bridge interno com a API.'
    });
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}
