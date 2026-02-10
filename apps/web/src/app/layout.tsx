import './globals.css';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import { Manrope, Cormorant_Garamond } from 'next/font/google';

const bodyFont = Manrope({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const displayFont = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700']
});

export const metadata = {
  title: 'QUEROBROApp',
  description: 'Dashboard web do QUEROBROApp'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${bodyFont.variable} ${displayFont.variable} bg-neutral-50 text-neutral-900`}>
        <div className="app-shell">
          <aside className="app-sidebar">
            <div className="app-brand">
              <p className="app-brand__eyebrow">ERP</p>
              <h1 className="app-brand__name">QUEROBROApp</h1>
              <p className="app-brand__tag">Operacao premium e sensorial</p>
            </div>
            <Nav />
            <div className="app-sidecard">
              <p className="app-sidecard__title">Status do dia</p>
              <p className="app-sidecard__value">Fluxo estavel</p>
              <p className="app-sidecard__hint">Estoques, pedidos e caixa em sincronia.</p>
            </div>
          </aside>
          <div className="app-main">
            <header className="app-topbar">
              <div>
                <p className="app-topbar__eyebrow">Painel</p>
                <h2 className="app-topbar__title">Visao geral</h2>
              </div>
              <div className="app-topbar__actions">
                <button className="app-ghost">Exportar</button>
                <button className="app-primary">Criar novo</button>
              </div>
            </header>
            <main className="app-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
