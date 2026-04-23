import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const iconVersion = '20260410d';

export const metadata: Metadata = {
  icons: {
    icon: [{ url: `/estoque/apple-icon.png?v=${iconVersion}`, sizes: '180x180', type: 'image/png' }],
    shortcut: `/estoque/apple-icon.png?v=${iconVersion}`,
    apple: [{ url: `/estoque/apple-icon.png?v=${iconVersion}`, sizes: '180x180', type: 'image/png' }]
  }
};

export default function EstoqueLayout({ children }: { children: ReactNode }) {
  return children;
}
