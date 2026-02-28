import './globals.css';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import { Topbar } from '@/components/topbar';
import { FlowDock } from '@/components/flow-dock';
import { OperationFlowProvider } from '@/hooks/use-operation-flow';
import { BuilderRuntimeTheme } from '@/components/builder-runtime-theme';
import { FeedbackProvider } from '@/components/feedback-provider';
import { Manrope, Cormorant_Garamond } from 'next/font/google';

const bodyFont = Manrope({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const displayFont = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata = {
  title: 'Broa do Dia',
  description: 'Operacao diaria da broa, da producao ao caixa.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        <BuilderRuntimeTheme />
        <FeedbackProvider>
          <div className="app-shell">
            <aside className="app-sidebar">
              <div className="app-brand">
                <p className="app-brand__eyebrow">Operacao diaria</p>
                <h1 className="app-brand__name">Broa do Dia</h1>
                <p className="app-brand__tag">Produzir, sair, receber e fechar o dia.</p>
              </div>
              <Nav />
            </aside>
            <div className="app-main">
              <OperationFlowProvider refreshIntervalMs={30000}>
                <Topbar />
                <FlowDock />
                <main className="app-content">{children}</main>
              </OperationFlowProvider>
            </div>
          </div>
        </FeedbackProvider>
      </body>
    </html>
  );
}
