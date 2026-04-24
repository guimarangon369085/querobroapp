import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { Product } from '@querobroapp/shared';
import { PublicOrderPage } from './public-order-page';
import { fetchPublicOrderCatalog } from '@/lib/public-order-catalog';
import { buildPublicAppUrl } from '@/lib/public-site-config';
import { resolveServerBridgeApiBaseUrl } from '@/lib/server-bridge-api-base-url';

const pageTitle = '@QUEROBROA';
const pageDescription = 'Sua vida + broa :) 🙂';
const socialImagePath = '/querobroa-brand/stack-wide.jpg';

export function generateMetadata(): Metadata {
  const canonicalUrl = buildPublicAppUrl('/pedido', {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });
  const socialImageUrl = buildPublicAppUrl(socialImagePath, {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });
  const iconVersion = '20260410d';

  return {
    title: pageTitle,
    description: pageDescription,
    icons: {
      icon: [{ url: `/pedido/icon.png?v=${iconVersion}`, sizes: '512x512', type: 'image/png' }],
      shortcut: `/pedido/icon.png?v=${iconVersion}`,
      apple: [{ url: `/pedido/apple-icon.png?v=${iconVersion}`, sizes: '180x180', type: 'image/png' }]
    },
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
      title: '@QUEROBROA',
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
              alt: 'Broas QUEROBROA empilhadas em preview largo sobre fundo verde-claro'
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

export default async function PedidoPage() {
  let initialCatalogProducts: Product[] = [];
  const showCompanionProducts = true;
  const sumupEnabled = Boolean(
    String(process.env.SUMUP_API_KEY || '').trim() && String(process.env.SUMUP_MERCHANT_CODE || '').trim()
  );

  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host') || '127.0.0.1:3000';
    const forwardedProto = requestHeaders.get('x-forwarded-proto');
    const protocol =
      forwardedProto ||
      (host.includes('127.0.0.1') || host.includes('localhost') || host.includes('::1') ? 'http' : 'https');
    const request = new Request(`${protocol}://${host}/pedido`, {
      headers: new Headers(requestHeaders)
    });

    initialCatalogProducts = await fetchPublicOrderCatalog(
      resolveServerBridgeApiBaseUrl(request, process.env.ORDER_FORM_API_URL)
    );
  } catch {
    initialCatalogProducts = [];
  }

  return (
    <PublicOrderPage
      initialCatalogProducts={initialCatalogProducts}
      showCompanionProducts={showCompanionProducts}
      sumupEnabled={sumupEnabled}
    />
  );
}
