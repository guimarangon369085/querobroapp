import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildErrorResponse(400, {
      message: 'Payload invalido para cotacao do frete.'
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const bridgeToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  if (bridgeToken) {
    headers.Authorization = `Bearer ${bridgeToken}`;
  }

  try {
    const response = await fetch(`${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/deliveries/quotes`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store'
    });

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
    return buildErrorResponse(502, {
      message:
        error instanceof Error
          ? `Falha ao conectar a cotacao de entrega com a API: ${error.message}`
          : 'Falha ao conectar a cotacao de entrega com a API.'
    });
  }
}
