import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';
const DELIVERY_QUOTE_BRIDGE_TIMEOUT_MS = 12_000;

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildErrorResponse(400, {
      message: 'Payload inválido para cotação do frete.'
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const appToken = String(process.env.APP_API_BRIDGE_TOKEN || process.env.APP_AUTH_TOKEN || '').trim();
  const bridgeToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const baseUrl = resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL);
  const upstreamPath = appToken ? '/deliveries/quotes/internal' : '/deliveries/quotes';

  if (appToken) {
    headers['x-app-token'] = appToken;
  } else if (bridgeToken) {
    headers.Authorization = `Bearer ${bridgeToken}`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_QUOTE_BRIDGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${upstreamPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw ? { message: raw } : null;
    }
    return new NextResponse(JSON.stringify(payload), {
      status: response.status,
      headers: {
        'Content-Type': contentType
      }
    });
  } catch (error) {
    if (isAbortError(error)) {
      return buildErrorResponse(504, {
        message: 'A cotação do frete demorou mais que o esperado. Tente novamente.'
      });
    }
    return buildErrorResponse(502, {
      message:
        error instanceof Error
          ? `Falha ao conectar a cotação de entrega com a API: ${error.message}`
          : 'Falha ao conectar a cotação de entrega com a API.'
    });
  }
}
