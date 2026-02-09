import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'QuerobroApp',
  description: 'Dashboard web do QuerobroApp'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
