import type { MetadataRoute } from 'next';
import { buildPublicAppUrl } from '@/lib/public-site-config';

export default function sitemap(): MetadataRoute.Sitemap {
  const homeUrl = buildPublicAppUrl('/', {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });
  const publicOrderUrl = buildPublicAppUrl('/pedido', {
    allowLocalFallback: process.env.NODE_ENV !== 'production'
  });

  if (!homeUrl || !publicOrderUrl) {
    return [];
  }

  return [
    {
      url: homeUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1
    },
    {
      url: publicOrderUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9
    }
  ];
}
