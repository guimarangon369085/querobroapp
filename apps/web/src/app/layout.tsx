import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BuilderRuntimeTheme } from '@/components/builder-runtime-theme';
import { FeedbackProvider } from '@/components/feedback-provider';
import { RuntimeRecovery } from '@/components/runtime-recovery';
import { RenderStabilityGuard } from '@/components/render-stability-guard';
import { AppFrame } from '@/components/app-frame';
import { getPublicAppOrigin } from '@/lib/public-site-config';

const metadataBase = getPublicAppOrigin({ allowLocalFallback: process.env.NODE_ENV !== 'production' });

export const metadata: Metadata = {
  metadataBase: metadataBase ? new URL(metadataBase) : undefined,
  title: 'QUEROBROAPP',
  description: 'Operacao diaria da Broa com pedidos, clientes e estoque.',
  applicationName: 'QUEROBROAPP',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/broa-mark.svg',
    shortcut: '/broa-mark.svg',
    apple: '/broa-mark.svg'
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
        <RenderStabilityGuard />
        <RuntimeRecovery />
        <BuilderRuntimeTheme />
        <FeedbackProvider>
          <AppFrame>{children}</AppFrame>
        </FeedbackProvider>
      </body>
    </html>
  );
}
