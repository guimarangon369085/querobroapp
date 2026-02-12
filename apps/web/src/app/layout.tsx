import './globals.css';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import { Topbar } from '@/components/topbar';
import { BuilderRuntimeTheme } from '@/components/builder-runtime-theme';
import { Manrope, Cormorant_Garamond } from 'next/font/google';

const bodyFont = Manrope({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const displayFont = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata = {
  title: 'QUEROBROApp',
  description: 'Dashboard web do QUEROBROApp',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        <BuilderRuntimeTheme />
        <div className="app-shell">
          <aside className="app-sidebar">
            <div className="app-brand">
              <p className="app-brand__eyebrow">ERP artesanal</p>
              <h1 className="app-brand__name">QUEROBROApp</h1>
              <p className="app-brand__tag">Operacao premium, sensorial e orientada por dados.</p>
            </div>
            <Nav />
            <div className="app-sidecard">
              <p className="app-sidecard__title">Direcao visual</p>
              <p className="app-sidecard__value">Soft-edge high-end</p>
              <p className="app-sidecard__hint">
                Interface redesenhada para priorizar legibilidade, foco operacional e conforto
                visual.
              </p>
            </div>
          </aside>
          <div className="app-main">
            <Topbar />
            <main className="app-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
