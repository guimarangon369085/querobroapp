import './globals.css';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import { Topbar } from '@/components/topbar';
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
  description: 'Operacao diaria da broa em cinco telas: pedidos, calendario, clientes, produtos e estoque.',
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
                <h1 className="app-brand__name">Broa do Dia</h1>
              </div>
              <Nav />
            </aside>
            <div className="app-main">
              <Topbar />
              <main className="app-content">{children}</main>
            </div>
          </div>
        </FeedbackProvider>
      </body>
    </html>
  );
}
