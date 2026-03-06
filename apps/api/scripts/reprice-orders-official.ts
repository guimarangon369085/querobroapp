import { PrismaService } from '../src/prisma.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';

function ensureDatabaseUrl() {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  if (!isProd && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./dev.db';
  }
  if (isProd && !process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
  }
}

async function main() {
  ensureDatabaseUrl();

  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const service = new OrdersService(prisma);
    const result = await service.repriceAllOrdersToOfficialScheme();
    console.log(
      `[orders:reprice:official] scanned=${result.scanned} updated=${result.updated} unchanged=${result.unchanged} subtotalDelta=${result.subtotalDelta.toFixed(2)} totalDelta=${result.totalDelta.toFixed(2)}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[orders:reprice:official] failed: ${message}`);
  process.exitCode = 1;
});
