import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ImmersiveHomeHero } from '@/components/home/immersive-home-hero';
import { buildPublicAppUrl, isOpsHost } from '@/lib/public-site-config';

const pageTitle = 'QUEROBROA';
const pageDescription = 'Sua vida + broa :) 🙂';
const homeSocialImagePath = '/querobroa-brand/stack-wide.jpg';

export function generateMetadata(): Metadata {
  const canonicalUrl = buildPublicAppUrl('/', {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });
  const socialImageUrl = buildPublicAppUrl(homeSocialImagePath, {
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
      title: pageTitle,
      description: pageDescription,
      url: canonicalUrl || undefined,
      siteName: 'QUEROBROA',
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

export default async function HomePage() {
  const requestHeaders = await headers();
  const hostname = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host');

  if (isOpsHost(hostname)) {
    redirect('/pedidos');
  }

  return <ImmersiveHomeHero />;
}
