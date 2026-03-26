import './globals.css';
import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { BuilderRuntimeTheme } from '@/components/builder-runtime-theme';
import { FeedbackProvider } from '@/components/feedback-provider';
import { RuntimeRecovery } from '@/components/runtime-recovery';
import { RenderStabilityGuard } from '@/components/render-stability-guard';
import { ViewportMetricsSync } from '@/components/viewport-metrics-sync';
import { AppFrame } from '@/components/app-frame';
import { AnalyticsTracker } from '@/components/analytics-tracker';
import { getPublicAppOrigin } from '@/lib/public-site-config';

const metadataBase = getPublicAppOrigin({ allowLocalFallback: process.env.NODE_ENV !== 'production' });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: metadataBase ? new URL(metadataBase) : undefined,
  title: 'QUEROBROAPP',
  description: 'Operacao diaria da Broa com pedidos, clientes e estoque.',
  applicationName: 'QUEROBROAPP',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'QUEROBROA'
  },
  icons: {
    icon: [
      { url: '/querobroa-brand/icons/querobroa-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/querobroa-brand/icons/querobroa-icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    shortcut: '/querobroa-brand/icons/querobroa-icon-192.png',
    apple: '/querobroa-brand/icons/apple-touch-icon.png'
  },
  openGraph: {
    siteName: 'QUEROBROAPP',
    locale: 'pt_BR',
    type: 'website'
  },
  twitter: {
    card: 'summary_large_image'
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <ViewportMetricsSync />
        <RenderStabilityGuard />
        <RuntimeRecovery />
        <BuilderRuntimeTheme />
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
        <FeedbackProvider>
          <AppFrame>{children}</AppFrame>
        </FeedbackProvider>
      </body>
    </html>
  );
}
