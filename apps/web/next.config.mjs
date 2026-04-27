const nextDistDir = process.env.NEXT_DIST_DIR?.trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@querobroapp/shared', '@querobroapp/ui'],
  ...(nextDistDir ? { distDir: nextDistDir } : {}),
  experimental: {
    devtoolSegmentExplorer: false
  },
  async redirects() {
    return [
      {
        source: '/calendario',
        destination: '/pedidos',
        permanent: true
      },
      {
        source: '/inicio',
        destination: '/pedidos',
        permanent: true
      },
      {
        source: '/resumo',
        destination: '/pedidos',
        permanent: true
      }
    ];
  }
};

export default nextConfig;
