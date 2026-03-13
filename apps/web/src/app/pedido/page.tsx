import type { Metadata } from 'next';
import { PublicOrderPage } from './public-order-page';
import { buildPublicAppUrl } from '@/lib/public-site-config';

const pageTitle = 'Fazer pedido | QUEROBROAPP';
const pageDescription = 'Pagina publica para o cliente montar o pedido, cotar a entrega e receber o PIX.';
const socialImagePath = '/querobroa-brand/fornada.jpg';

export function generateMetadata(): Metadata {
  const canonicalUrl = buildPublicAppUrl('/pedido', {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });
  const socialImageUrl = buildPublicAppUrl(socialImagePath, {
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
      index: true,
      follow: true
    },
    openGraph: {
      title: 'Pedido publico | QUEROBROAPP',
      description: pageDescription,
      url: canonicalUrl || undefined,
      siteName: 'QUEROBROAPP',
      locale: 'pt_BR',
      type: 'website',
      images: socialImageUrl
        ? [
            {
              url: socialImageUrl,
              width: 1200,
              height: 630,
              alt: 'Broas QUEROBROA em destaque'
            }
          ]
        : undefined
    },
    twitter: {
      card: socialImageUrl ? 'summary_large_image' : 'summary',
      title: pageTitle,
      description: pageDescription,
      images: socialImageUrl ? [socialImageUrl] : undefined
    }
  };
}

export default function PedidoPage() {
  return <PublicOrderPage />;
}
