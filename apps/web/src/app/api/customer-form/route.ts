import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

function sanitizePublicCustomerFormSuccessPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return payload;

  const record = payload as Record<string, unknown>;
  const order = record.order;
  const intake = record.intake;
  if (!order || typeof order !== 'object' || !intake || typeof intake !== 'object') {
    return payload;
  }

  const orderRecord = order as Record<string, unknown>;
  const intakeRecord = intake as Record<string, unknown>;
  return {
    order: {
      total:
        typeof orderRecord.total === 'number' && Number.isFinite(orderRecord.total)
          ? orderRecord.total
          : null,
      scheduledAt: typeof orderRecord.scheduledAt === 'string' ? orderRecord.scheduledAt : null
    },
    intake: {
      stage:
        (typeof intakeRecord.stage === 'string' && intakeRecord.stage.trim()) || 'CONFIRMED',
      deliveryFee:
        typeof intakeRecord.deliveryFee === 'number' && Number.isFinite(intakeRecord.deliveryFee)
          ? intakeRecord.deliveryFee
          : 0,
      paymentMethod: intakeRecord.paymentMethod === 'card' ? 'card' : 'pix',
      pixCharge: intakeRecord.pixCharge ?? null,
      cardCheckout: intakeRecord.cardCheckout ?? null
    }
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildErrorResponse(400, {
      message: 'Payload inválido para envio do pedido.'
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  try {
    headers['x-public-app-origin'] = new URL(request.url).origin;
  } catch (error) {
    void error;
  }
  const bridgeToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  if (bridgeToken) {
    headers.Authorization = `Bearer ${bridgeToken}`;
  }

  try {
    const response = await fetch(`${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/orders/intake/customer-form`, {
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
    const responsePayload = response.ok ? sanitizePublicCustomerFormSuccessPayload(payload) : payload;
    return new NextResponse(JSON.stringify(responsePayload), {
      status: response.status,
      headers: {
        'Content-Type': contentType
      }
    });
  } catch (error) {
    return buildErrorResponse(502, {
      message:
        error instanceof Error
          ? `Falha ao conectar o formulário com a API: ${error.message}`
          : 'Falha ao conectar o formulário com a API.'
    });
  }
}
