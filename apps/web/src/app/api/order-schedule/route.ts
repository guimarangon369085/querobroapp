import { NextResponse } from 'next/server';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const requestedDate = requestUrl.searchParams.get('date');
  const timeWindow = requestUrl.searchParams.get('timeWindow');
  const scheduledAt = requestUrl.searchParams.get('scheduledAt');
  const totalBroas = requestUrl.searchParams.get('totalBroas');
  const upstreamUrl = new URL(
    `${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/orders/public-schedule`
  );

  if (requestedDate) {
    upstreamUrl.searchParams.set('date', requestedDate);
  }
  if (timeWindow) {
    upstreamUrl.searchParams.set('timeWindow', timeWindow);
  }
  if (scheduledAt) {
    upstreamUrl.searchParams.set('scheduledAt', scheduledAt);
  }
  if (totalBroas) {
    upstreamUrl.searchParams.set('totalBroas', totalBroas);
  }

  try {
    const response = await fetch(upstreamUrl, {
      method: 'GET',
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
          ? `Falha ao consultar agenda publica na API: ${error.message}`
          : 'Falha ao consultar agenda publica na API.'
    });
  }
}
