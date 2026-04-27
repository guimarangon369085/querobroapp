import type { Metadata } from 'next';
import OrdersScreen from '@/features/orders/orders-screen';
import { requireOpsPageAccess } from '@/lib/ops-page-access';

const iconVersion = '20260410d';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'QUEROBROAPP',
  icons: {
    icon: [{ url: `/pedidos/apple-icon.png?v=${iconVersion}`, sizes: '180x180', type: 'image/png' }],
    shortcut: `/pedidos/apple-icon.png?v=${iconVersion}`,
    apple: [{ url: `/pedidos/apple-icon.png?v=${iconVersion}`, sizes: '180x180', type: 'image/png' }]
  }
};

export default async function PedidosPage() {
  await requireOpsPageAccess('/pedidos');
  return <OrdersScreen />;
}
