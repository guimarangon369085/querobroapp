import type { MetadataRoute } from 'next';
import { getPublicAppOrigin } from '@/lib/public-site-config';

export default function robots(): MetadataRoute.Robots {
  const origin = getPublicAppOrigin({ allowLocalFallback: process.env.NODE_ENV !== 'production' });

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pedido'],
        disallow: [
          '/api/',
          '/pedidos',
          '/clientes',
          '/estoque',
          '/dashboard',
          '/inicio',
          '/jornada',
          '/hoje',
          '/resumo',
          '/base',
          '/builder',
          '/producao',
          '/produtos',
          '/saidas',
          '/caixa',
          '/whatsapp-flow'
        ]
      }
    ],
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
    host: origin || undefined
  };
}
