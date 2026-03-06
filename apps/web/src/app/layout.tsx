import './globals.css';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import { Topbar } from '@/components/topbar';
import { BuilderRuntimeTheme } from '@/components/builder-runtime-theme';
import { FeedbackProvider } from '@/components/feedback-provider';
import { RuntimeRecovery } from '@/components/runtime-recovery';
import { RenderStabilityGuard } from '@/components/render-stability-guard';

export const metadata = {
  title: 'QUEROBROAPP',
  description: 'Operacao diaria da Broa com pedidos, clientes, produtos e estoque.',
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
          <div className="app-shell">
            <aside className="app-sidebar">
              <div className="app-brand">
                <div className="app-brand__logo">
                  <h1 className="app-brand__name">@QUEROBROApp</h1>
                </div>
              </div>
              <Nav />
            </aside>
            <div className="app-main">
              <main className="app-content">
                <Topbar />
                {children}
              </main>
            </div>
          </div>
        </FeedbackProvider>
      </body>
    </html>
  );
}
