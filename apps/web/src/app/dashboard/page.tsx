import type { Metadata } from 'next';
import DashboardScreen from '@/features/dashboard/dashboard-screen';
import { requireOpsPageAccess } from '@/lib/ops-page-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard | QUEROBROAPP',
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardPage() {
  await requireOpsPageAccess('/dashboard');
  return <DashboardScreen />;
}
