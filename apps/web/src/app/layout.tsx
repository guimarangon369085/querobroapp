import './globals.css';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';

export const metadata = {
  title: 'QuerobroApp',
  description: 'Dashboard web do QuerobroApp'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">ERP</p>
              <h1 className="text-lg font-semibold">QuerobroApp</h1>
            </div>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
