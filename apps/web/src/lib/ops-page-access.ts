import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { OPS_SESSION_COOKIE_NAME, getOpsAccessConfig, resolveSafeNextPath } from '@/lib/ops-access';
import { readValidOpsSession } from '@/lib/ops-session';

export async function requireOpsPageAccess(pathname: string) {
  const config = getOpsAccessConfig();
  if (!config.enabled) return;

  const cookieStore = await cookies();
  const session = await readValidOpsSession(cookieStore.get(OPS_SESSION_COOKIE_NAME)?.value);
  if (session) return;

  redirect(`/acesso?next=${encodeURIComponent(resolveSafeNextPath(pathname))}`);
}
