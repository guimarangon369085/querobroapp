import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import DashboardScreen from '@/features/dashboard/dashboard-screen';
import { isOpsOrLoopbackHost, resolveRequestHostFromHeaders } from '@/lib/public-site-config';

export const metadata: Metadata = {
  title: 'Dashboard | QUEROBROAPP',
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardPage() {
  const headerList = await headers();
  const requestHost = resolveRequestHostFromHeaders(headerList);
  if (!isOpsOrLoopbackHost(requestHost)) {
    notFound();
  }
  return <DashboardScreen />;
}
