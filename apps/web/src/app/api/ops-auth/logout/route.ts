import { NextResponse } from 'next/server';
import { getOpsSessionCookieOptions } from '@/lib/ops-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...getOpsSessionCookieOptions(request.url),
    value: '',
    maxAge: 0
  });
  return response;
}
