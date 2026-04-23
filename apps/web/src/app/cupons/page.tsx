import type { Metadata } from 'next';
import CouponsScreen from '@/features/coupons/coupons-screen';
import { requireOpsPageAccess } from '@/lib/ops-page-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cupons | QUEROBROAPP',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CuponsPage() {
  await requireOpsPageAccess('/cupons');
  return <CouponsScreen />;
}
