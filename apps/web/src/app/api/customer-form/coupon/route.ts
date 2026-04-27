import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';
import { isTrustedSameOriginBridgeRequest } from '@/lib/server-bridge-access';

export const dynamic = 'force-dynamic';
const PUBLIC_COUPON_REJECTION_MESSAGE = 'CUPOM NÃO VÁLIDO / JÁ UTILIZADO';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginBridgeRequest(request)) {
    return buildErrorResponse(404, { message: 'Não encontrado.' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildErrorResponse(400, {
      message: 'Payload inválido para validação do cupom.'
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
    const response = await fetch(
      `${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/dashboard/coupons/resolve`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store'
      }
    );

    const raw = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw ? { message: raw } : null;
    }
    if (!response.ok && response.status === 400) {
      payload = {
        ...(payload && typeof payload === 'object' ? payload : {}),
        message: PUBLIC_COUPON_REJECTION_MESSAGE
      };
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
          ? `Falha ao validar o cupom: ${error.message}`
          : 'Falha ao validar o cupom.'
    });
  }
}
