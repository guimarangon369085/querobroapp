import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QUEROBROAPP | Pedido publico',
    short_name: 'QUEROBROAPP',
    description: 'Monte seu pedido de broas, confira o total e receba o PIX na hora.',
    start_url: '/pedido',
    scope: '/pedido',
    display: 'standalone',
    background_color: '#f8efe5',
    theme_color: '#a15427',
    icons: [
      {
        src: '/broa-mark.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any'
      }
    ]
  };
}
