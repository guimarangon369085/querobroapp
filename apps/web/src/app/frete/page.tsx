import type { Metadata } from 'next';
import FreteScreen from '@/features/deliveries/frete-screen';
import { requireOpsPageAccess } from '@/lib/ops-page-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Frete | QUEROBROAPP',
  robots: {
    index: false,
    follow: false
  }
};

export default async function FretePage() {
  await requireOpsPageAccess('/frete');
  return <FreteScreen />;
}
