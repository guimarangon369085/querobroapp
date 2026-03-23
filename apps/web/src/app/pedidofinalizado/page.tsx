import type { Metadata } from 'next';
import { PublicOrderSuccessPage } from '../pedido/public-order-success-page';
import { buildPublicAppUrl } from '@/lib/public-site-config';

const pageTitle = 'Pedido finalizado | QUEROBROAPP';
const pageDescription = 'Pedido concluido com sucesso. Confira o PIX e siga para o pagamento.';

export function generateMetadata(): Metadata {
  const canonicalUrl = buildPublicAppUrl('/pedidofinalizado', {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });

  return {
    title: pageTitle,
    description: pageDescription,
    alternates: canonicalUrl
      ? {
          canonical: canonicalUrl
        }
      : undefined,
    robots: {
      index: false,
      follow: false
    }
  };
}

export default function PedidoFinalizadoPage() {
  return <PublicOrderSuccessPage />;
}
