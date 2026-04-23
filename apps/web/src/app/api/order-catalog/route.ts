import { NextResponse } from 'next/server';
import { fetchPublicOrderCatalog } from '@/lib/public-order-catalog';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  try {
    const payload = await fetchPublicOrderCatalog(
      resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)
    );
    return new NextResponse(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
      }
    });
  } catch (error) {
    return buildErrorResponse(502, {
      message:
        error instanceof Error
          ? `Falha ao carregar o catálogo público: ${error.message}`
          : 'Falha ao carregar o catálogo público.',
    });
  }
}
