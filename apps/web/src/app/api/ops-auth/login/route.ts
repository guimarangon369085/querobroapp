import { NextResponse } from 'next/server';
import { getOpsAccessConfig, resolveSafeNextPath } from '@/lib/ops-access';
import { createOpsSessionCookieValue, getOpsSessionCookieOptions } from '@/lib/ops-session';

export const dynamic = 'force-dynamic';

function buildErrorResponse(status: number, message: string) {
  return NextResponse.json({ message }, { status });
}

export async function POST(request: Request) {
  const config = getOpsAccessConfig();
  if (!config.enabled) {
    return NextResponse.json({ ok: true, next: '/pedidos' });
  }
  if (!config.credentialsBySecret.size || !config.signingSecret) {
    return buildErrorResponse(503, 'Acesso operacional indisponível: credencial não configurada.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildErrorResponse(400, 'Payload inválido para autenticação.');
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const submittedSecret = String(record.password || '').trim();
  const next = resolveSafeNextPath(String(record.next || '').trim());

  if (!submittedSecret) {
    return buildErrorResponse(400, 'Informe a senha operacional.');
  }

  const credential = config.credentialsBySecret.get(submittedSecret);
  if (!credential) {
    return buildErrorResponse(401, 'Senha operacional inválida.');
  }

  const sessionValue = await createOpsSessionCookieValue({
    role: credential.role,
    label: credential.label
  });
  const response = NextResponse.json({ ok: true, next });
  response.cookies.set({
    ...getOpsSessionCookieOptions(request.url),
    value: sessionValue
  });
  return response;
}
