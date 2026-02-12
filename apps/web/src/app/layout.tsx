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
  title: 'QUEROBROApp',
  description: 'Dashboard web do QUEROBROApp',
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
                <p className="app-brand__eyebrow">ERP artesanal</p>
                <h1 className="app-brand__name">QUEROBROApp</h1>
                <p className="app-brand__tag">Operacao simples, clara e eficiente.</p>
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
