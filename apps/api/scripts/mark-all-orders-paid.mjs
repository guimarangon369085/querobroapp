import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient as LocalPrismaClient } from '@prisma/client';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(scriptDir, '..');
const prodSchemaPath = path.join(apiDir, 'prisma', 'schema.prod.prisma');

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function compareMoney(left, right) {
  return round2(left) - round2(right);
}

function resolveProdDatabaseUrl() {
  const raw =
    process.env.QBAPP_TARGET_DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.DATABASE_URL_PROD ||
    process.env.DATABASE_URL ||
    '';
  if (!raw.trim()) {
    throw new Error('Defina DATABASE_URL, DATABASE_URL_PROD ou DATABASE_PUBLIC_URL para continuar.');
  }

  const url = new URL(raw);
  if (url.hostname.endsWith('.proxy.rlwy.net') && !url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
  return url.toString();
}

function ensureDatabaseUrl() {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  if (!isProd && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./dev.db';
  }
  if (isProd && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = resolveProdDatabaseUrl();
  }
}

async function prepareTempProdClient() {
  const tempRoot = path.join(apiDir, '.codex-temp');
  await fs.mkdir(tempRoot, { recursive: true });
  const tempBase = await fs.mkdtemp(path.join(tempRoot, 'qb-prisma-paid-'));
  const outputDir = path.join(tempBase, 'client');
  const tempSchemaPath = path.join(tempBase, 'schema.prisma');
  const sourceSchema = await fs.readFile(prodSchemaPath, 'utf8');
  const patchedSchema = sourceSchema.replace(
    /generator client \{([\s\S]*?)\}/,
    (_match, inner) =>
      `generator client {${inner}\n  output = "${outputDir.replace(/\\/g, '\\\\')}"\n}`
  );

  await fs.writeFile(tempSchemaPath, patchedSchema, 'utf8');
  await execFileAsync('pnpm', ['exec', 'prisma', 'generate', '--schema', tempSchemaPath], {
    cwd: apiDir,
    env: {
      ...process.env,
      PRISMA_GENERATE_SKIP_AUTOINSTALL: '1'
    }
  });

  const moduleUrl = pathToFileURL(path.join(outputDir, 'index.js')).href;
  const imported = await import(moduleUrl);

  return {
    PrismaClient: imported.PrismaClient,
    cleanup: () => fs.rm(tempBase, { recursive: true, force: true })
  };
}

async function createPrismaClient() {
  ensureDatabaseUrl();
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

  if (!isProd) {
    return {
      prisma: new LocalPrismaClient({
        datasources: {
          db: { url: process.env.DATABASE_URL }
        }
      }),
      cleanup: async () => {}
    };
  }

  const { PrismaClient, cleanup } = await prepareTempProdClient();
  return {
    prisma: new PrismaClient({
      datasources: {
        db: { url: process.env.DATABASE_URL }
      }
    }),
    cleanup
  };
}

async function main() {
  const { prisma, cleanup } = await createPrismaClient();
  await prisma.$connect();

  try {
    const orders = await prisma.order.findMany({
      include: { payments: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    let updatedOrders = 0;
    let reusedPayments = 0;
    let createdPayments = 0;
    let alreadyPaid = 0;

    for (const order of orders) {
      const total = round2(order.total || 0);
      const paidAmount = round2(
        (order.payments || []).reduce((sum, payment) => {
          const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
          return isPaid ? sum + Number(payment.amount || 0) : sum;
        }, 0)
      );
      const balanceDue = round2(Math.max(total - paidAmount, 0));

      if (compareMoney(balanceDue, 0) <= 0) {
        alreadyPaid += 1;
        continue;
      }

      const paidAt = order.scheduledAt || order.createdAt || new Date();
      const reusablePendingPayment =
        (order.payments || []).find(
          (payment) =>
            payment.status !== 'PAGO' &&
            !payment.paidAt &&
            String(payment.method || '').trim().toLowerCase() === 'pix' &&
            compareMoney(payment.amount || 0, balanceDue) === 0
        ) || null;

      await prisma.$transaction(async (tx) => {
        if (reusablePendingPayment) {
          await tx.payment.update({
            where: { id: reusablePendingPayment.id },
            data: {
              status: 'PAGO',
              paidAt
            }
          });
          reusedPayments += 1;
          return;
        }

        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: balanceDue,
            method: 'pix',
            status: 'PAGO',
            paidAt
          }
        });
        createdPayments += 1;
      });

      updatedOrders += 1;
    }

    const finalOrders = await prisma.order.findMany({
      include: { payments: true }
    });
    const paidOrders = finalOrders.filter((order) => {
      const total = round2(order.total || 0);
      const paidAmount = round2(
        (order.payments || []).reduce((sum, payment) => {
          const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
          return isPaid ? sum + Number(payment.amount || 0) : sum;
        }, 0)
      );
      return compareMoney(total - paidAmount, 0) <= 0;
    }).length;

    console.log(
      JSON.stringify(
        {
          scanned: orders.length,
          updatedOrders,
          reusedPayments,
          createdPayments,
          alreadyPaid,
          fullyPaidOrders: paidOrders
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
    await cleanup();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[orders:mark-all-paid] failed: ${message}`);
  process.exitCode = 1;
});
