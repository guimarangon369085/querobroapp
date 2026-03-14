import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { buildPublicAppUrl, isOpsHost } from '@/lib/public-site-config';

const pageTitle = 'QUEROBROA';
const pageDescription = 'Pedido publico em /pedido e operacao em /pedidos no mesmo app.';
const homeBackgroundImagePath = '/querobroa-brand/home-portrait.jpg';

export function generateMetadata(): Metadata {
  const canonicalUrl = buildPublicAppUrl('/', {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });
  const socialImageUrl = buildPublicAppUrl(homeBackgroundImagePath, {
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
              width: 1656,
              height: 2200,
              alt: 'Mulher sorrindo segurando uma bandeja de broas na frente da loja'
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

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#c9ab72] text-white">
      <Image
        alt="Mulher sorrindo segurando uma bandeja de broas na frente da loja"
        className="object-cover object-[center_28%]"
        fill
        priority
        sizes="100vw"
        src={homeBackgroundImagePath}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(32,18,7,0.08)_0%,rgba(32,18,7,0.18)_52%,rgba(18,10,4,0.46)_100%)]" />
      <section className="relative z-10 flex min-h-screen flex-col justify-end px-5 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10">
        <div className="max-w-[34rem]">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-[rgba(255,248,232,0.86)]">
            querobroa.com.br
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/18 bg-[rgba(56,34,14,0.44)] px-5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-[rgba(56,34,14,0.58)]"
              href="/pedido"
            >
              Fazer pedido
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
