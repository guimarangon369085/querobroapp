import type { Metadata } from 'next';
import DashboardScreen from '@/features/dashboard/dashboard-screen';

export const metadata: Metadata = {
  title: 'Dashboard | QUEROBROAPP',
  robots: {
    index: false,
    follow: false
  }
};

export default function DashboardPage() {
  return <DashboardScreen />;
}
