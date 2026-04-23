import type { Metadata } from 'next';
import ConfirmacoesQueueScreen from './queue-screen';
import { requireOpsPageAccess } from '@/lib/ops-page-access';

const iconVersion = '20260410d';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirmacoes | QUEROBROAPP',
  icons: {
    icon: [{ url: `/confirmacoes/apple-icon.png?v=${iconVersion}`, sizes: '180x180', type: 'image/png' }],
    shortcut: `/confirmacoes/apple-icon.png?v=${iconVersion}`,
    apple: [{ url: `/confirmacoes/apple-icon.png?v=${iconVersion}`, sizes: '180x180', type: 'image/png' }]
  },
  robots: {
    index: false,
    follow: false
  }
};

export default async function ConfirmacoesPage() {
  await requireOpsPageAccess('/confirmacoes');
  return <ConfirmacoesQueueScreen />;
}
