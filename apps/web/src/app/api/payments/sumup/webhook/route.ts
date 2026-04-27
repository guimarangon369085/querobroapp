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
      message: 'Webhook SumUp inválido.'
    });
  }

  const appToken = String(process.env.APP_API_BRIDGE_TOKEN || process.env.APP_AUTH_TOKEN || '').trim();
  if (!appToken) {
    return buildErrorResponse(500, {
      message: 'APP_API_BRIDGE_TOKEN ou APP_AUTH_TOKEN obrigatório para o webhook da SumUp.'
    });
  }

  try {
    const response = await fetch(
      `${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/payments/sumup/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': appToken
        },
        body: JSON.stringify(body),
        cache: 'no-store'
      }
    );

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const raw = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';
    return new NextResponse(raw, {
      status: response.status,
      headers: {
        'Content-Type': contentType
      }
    });
  } catch (error) {
    return buildErrorResponse(502, {
      message:
        error instanceof Error
          ? `Falha ao encaminhar o webhook da SumUp: ${error.message}`
          : 'Falha ao encaminhar o webhook da SumUp.'
    });
  }
}
