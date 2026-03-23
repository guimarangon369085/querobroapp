import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QUEROBROA | Pedido rapido',
    short_name: 'QUEROBROA',
    description: 'Atalho para montar o pedido, reaproveitar seus dados e refazer o ultimo pedido.',
    start_url: '/pedido',
    scope: '/',
    display: 'standalone',
    background_color: '#f8efe5',
    theme_color: '#a15427',
    icons: [
      {
        src: '/querobroa-brand/icons/querobroa-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: '/querobroa-brand/icons/querobroa-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  };
}
