import './globals.css';
import type { ReactNode } from 'react';
import { BuilderRuntimeTheme } from '@/components/builder-runtime-theme';
import { FeedbackProvider } from '@/components/feedback-provider';
import { RuntimeRecovery } from '@/components/runtime-recovery';
import { RenderStabilityGuard } from '@/components/render-stability-guard';
import { AppFrame } from '@/components/app-frame';

export const metadata = {
  title: 'QUEROBROAPP',
  description: 'Operacao diaria da Broa com pedidos, clientes e estoque.',
  icons: {
    icon: '/broa-mark.svg',
    shortcut: '/broa-mark.svg',
    apple: '/broa-mark.svg'
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
