import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ checkoutId: string }> }
) {
  const appToken = String(process.env.APP_API_BRIDGE_TOKEN || process.env.APP_AUTH_TOKEN || '').trim();
  if (!appToken) {
    return buildErrorResponse(500, {
      message: 'APP_API_BRIDGE_TOKEN ou APP_AUTH_TOKEN obrigatório para sincronizar checkout SumUp.'
    });
  }

  const { checkoutId } = await context.params;
  const normalizedCheckoutId = String(checkoutId || '').trim();
  if (!normalizedCheckoutId) {
    return buildErrorResponse(400, {
      message: 'Checkout SumUp inválido.'
    });
  }

  try {
    const response = await fetch(
      `${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/payments/sumup/checkouts/${encodeURIComponent(normalizedCheckoutId)}/sync`,
      {
        method: 'POST',
        headers: {
          'x-app-token': appToken
        },
        cache: 'no-store'
      }
    );

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
          ? `Falha ao sincronizar o checkout da SumUp: ${error.message}`
          : 'Falha ao sincronizar o checkout da SumUp.'
    });
  }
}
