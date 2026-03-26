import { NextResponse } from 'next/server';
import { BuilderConfigSchema } from '@querobroapp/shared';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  const headers = new Headers();
  const appToken = String(process.env.APP_API_BRIDGE_TOKEN || process.env.APP_AUTH_TOKEN || '').trim();
  if (appToken) {
    headers.set('x-app-token', appToken);
  }

  try {
    const response = await fetch(
      `${resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)}/runtime-config`,
      {
        method: 'GET',
        headers,
        cache: 'no-store'
      }
    );

    if (!response.ok) {
      const raw = await response.text();
      return buildErrorResponse(response.status, {
        message: raw || 'Falha ao carregar o tema publico.'
      });
    }

    const body = await response.json();
    const config = BuilderConfigSchema.parse({
      theme: body?.theme,
      forms: body?.forms,
      home: body?.home
    });

    return NextResponse.json(config, { status: 200 });
  } catch (error) {
    return buildErrorResponse(502, {
      message:
        error instanceof Error
          ? `Falha ao carregar o tema publico: ${error.message}`
          : 'Falha ao carregar o tema publico.'
    });
  }
}
