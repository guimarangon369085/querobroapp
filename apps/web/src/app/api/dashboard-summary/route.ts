import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';
import { isTrustedSameOriginBridgeRequest } from '@/lib/server-bridge-access';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  if (!isTrustedSameOriginBridgeRequest(request)) {
    return buildErrorResponse(404, { message: 'Nao encontrado.' });
  }

  const bridgeToken =
    String(process.env.DASHBOARD_BRIDGE_TOKEN || '').trim() ||
    String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();

  const headers: Record<string, string> = {};
  if (bridgeToken) {
    headers.Authorization = `Bearer ${bridgeToken}`;
  }

  try {
    const response = await fetch(
      `${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/dashboard/summary`,
      {
        method: 'GET',
        headers,
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
          ? `Falha ao conectar o dashboard com a API: ${error.message}`
          : 'Falha ao conectar o dashboard com a API.'
    });
  }
}
