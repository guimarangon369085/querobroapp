import { PrismaClient as LocalPrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(scriptDir, '..');
const prismaDir = path.join(apiDir, 'prisma');
const sourceDbPath = path.join(prismaDir, 'dev.db');
const prodSchemaPath = path.join(prismaDir, 'schema.prod.prisma');

const orderedTables = [
  { label: 'customers', tableName: 'Customer', deleteMany: 'customer', createMany: 'customer' },
  { label: 'products', tableName: 'Product', deleteMany: 'product', createMany: 'product' },
  { label: 'inventoryItems', tableName: 'InventoryItem', deleteMany: 'inventoryItem', createMany: 'inventoryItem' },
  { label: 'orders', tableName: 'Order', deleteMany: 'order', createMany: 'order' },
  { label: 'boms', tableName: 'Bom', deleteMany: 'bom', createMany: 'bom' },
  {
    label: 'idempotencyRecords',
    tableName: 'IdempotencyRecord',
    deleteMany: 'idempotencyRecord',
    createMany: 'idempotencyRecord'
  },
  { label: 'orderItems', tableName: 'OrderItem', deleteMany: 'orderItem', createMany: 'orderItem' },
  { label: 'payments', tableName: 'Payment', deleteMany: 'payment', createMany: 'payment' },
  {
    label: 'inventoryMovements',
    tableName: 'InventoryMovement',
    deleteMany: 'inventoryMovement',
    createMany: 'inventoryMovement'
  },
  { label: 'bomItems', tableName: 'BomItem', deleteMany: 'bomItem', createMany: 'bomItem' }
];

function resolveTargetDatabaseUrl() {
  const raw =
    process.env.QBAPP_TARGET_DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.DATABASE_URL_PROD ||
    process.env.DATABASE_URL ||
    '';
  if (!raw.trim()) {
    throw new Error(
      'Defina QBAPP_TARGET_DATABASE_URL, DATABASE_PUBLIC_URL ou DATABASE_URL_PROD com o Postgres de destino.'
    );
  }

  const url = new URL(raw);
  if (url.hostname.endsWith('.proxy.rlwy.net') && !url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
  return url.toString();
}

function assertOverwriteConfirmation() {
  if (process.env.QBAPP_SYNC_CONFIRM !== 'overwrite-target') {
    throw new Error(
      'Este script sobrescreve o banco de destino. Use QBAPP_SYNC_CONFIRM=overwrite-target para continuar.'
    );
  }
}

async function prepareTempProdClient() {
  const tempRoot = path.join(apiDir, '.codex-temp');
  await fs.mkdir(tempRoot, { recursive: true });
  const tempBase = await fs.mkdtemp(path.join(tempRoot, 'qb-prisma-sync-'));
  const outputDir = path.join(tempBase, 'client');
  const tempSchemaPath = path.join(tempBase, 'schema.prisma');
  const sourceSchema = await fs.readFile(prodSchemaPath, 'utf8');
  const patchedSchema = sourceSchema.replace(
    /generator client \{([\s\S]*?)\}/,
    (_match, inner) =>
      `generator client {${inner}\n  output = "${outputDir.replace(/\\/g, '\\\\')}"\n}`
  );

  await fs.writeFile(tempSchemaPath, patchedSchema, 'utf8');
  await execFileAsync(
    'pnpm',
    ['exec', 'prisma', 'generate', '--schema', tempSchemaPath],
    {
      cwd: apiDir,
      env: {
        ...process.env,
        PRISMA_GENERATE_SKIP_AUTOINSTALL: '1'
      }
    }
  );

  const moduleUrl = pathToFileURL(path.join(outputDir, 'index.js')).href;
  const imported = await import(moduleUrl);

  return {
    PrismaClient: imported.PrismaClient,
    cleanup: () => fs.rm(tempBase, { recursive: true, force: true })
  };
}

function summarizeCounts(entries) {
  return Object.fromEntries(entries.map(({ label, rows }) => [label, rows.length]));
}

async function resetSequences(prisma) {
  for (const { tableName } of orderedTables) {
    await prisma.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('"${tableName}"', 'id'),
        COALESCE((SELECT MAX(id) FROM "${tableName}"), 1),
        EXISTS(SELECT 1 FROM "${tableName}")
      );
    `);
  }
}

async function main() {
  assertOverwriteConfirmation();

  const targetDatabaseUrl = resolveTargetDatabaseUrl();
  const sourceDatabaseUrl = `file:${sourceDbPath}`;

  const local = new LocalPrismaClient({
    datasources: {
      db: { url: sourceDatabaseUrl }
    }
  });

  const { PrismaClient: TargetPrismaClient, cleanup } = await prepareTempProdClient();
  const target = new TargetPrismaClient({
    datasources: {
      db: { url: targetDatabaseUrl }
    }
  });

  try {
    const [
      customers,
      products,
      inventoryItems,
      orders,
      boms,
      idempotencyRecords,
      orderItems,
      payments,
      inventoryMovements,
      bomItems
    ] = await Promise.all([
      local.customer.findMany({ orderBy: { id: 'asc' } }),
      local.product.findMany({ orderBy: { id: 'asc' } }),
      local.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
      local.order.findMany({ orderBy: { id: 'asc' } }),
      local.bom.findMany({ orderBy: { id: 'asc' } }),
      local.idempotencyRecord.findMany({ orderBy: { id: 'asc' } }),
      local.orderItem.findMany({ orderBy: { id: 'asc' } }),
      local.payment.findMany({ orderBy: { id: 'asc' } }),
      local.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
      local.bomItem.findMany({ orderBy: { id: 'asc' } })
    ]);

    const customerIds = new Set(customers.map((row) => row.id));
    const productIds = new Set(products.map((row) => row.id));
    const inventoryItemIds = new Set(inventoryItems.map((row) => row.id));
    const orderIds = new Set(orders.filter((row) => customerIds.has(row.customerId)).map((row) => row.id));
    const bomIds = new Set(boms.filter((row) => productIds.has(row.productId)).map((row) => row.id));

    const sanitizedOrders = orders.filter((row) => customerIds.has(row.customerId));
    const sanitizedBoms = boms.filter((row) => productIds.has(row.productId));
    const sanitizedOrderItems = orderItems.filter(
      (row) => orderIds.has(row.orderId) && productIds.has(row.productId)
    );
    const sanitizedPayments = payments.filter((row) => orderIds.has(row.orderId));
    const sanitizedInventoryMovements = inventoryMovements.map((row) =>
      inventoryItemIds.has(row.itemId) && (!row.orderId || orderIds.has(row.orderId))
        ? row
        : inventoryItemIds.has(row.itemId)
          ? { ...row, orderId: null }
          : null
    ).filter(Boolean);
    const sanitizedBomItems = bomItems.filter(
      (row) => bomIds.has(row.bomId) && inventoryItemIds.has(row.itemId)
    );

    const payload = [
      { label: 'customers', rows: customers },
      { label: 'products', rows: products },
      { label: 'inventoryItems', rows: inventoryItems },
      { label: 'orders', rows: sanitizedOrders },
      { label: 'boms', rows: sanitizedBoms },
      { label: 'idempotencyRecords', rows: idempotencyRecords },
      { label: 'orderItems', rows: sanitizedOrderItems },
      { label: 'payments', rows: sanitizedPayments },
      { label: 'inventoryMovements', rows: sanitizedInventoryMovements },
      { label: 'bomItems', rows: sanitizedBomItems }
    ];

    await target.$transaction([
      target.bomItem.deleteMany(),
      target.inventoryMovement.deleteMany(),
      target.payment.deleteMany(),
      target.orderItem.deleteMany(),
      target.idempotencyRecord.deleteMany(),
      target.bom.deleteMany(),
      target.order.deleteMany(),
      target.inventoryItem.deleteMany(),
      target.product.deleteMany(),
      target.customer.deleteMany()
    ]);

    for (const spec of orderedTables) {
      const rows = payload.find((entry) => entry.label === spec.label)?.rows || [];
      if (rows.length === 0) continue;
      await target[spec.createMany].createMany({ data: rows });
    }

    await resetSequences(target);

    const targetCounts = await Promise.all(
      orderedTables.map(async (spec) => ({
        label: spec.label,
        count: await target[spec.deleteMany].count()
      }))
    );

    console.log(
      JSON.stringify(
        {
          source: summarizeCounts(payload),
          target: Object.fromEntries(targetCounts.map(({ label, count }) => [label, count]))
        },
        null,
        2
      )
    );
  } finally {
    await Promise.allSettled([local.$disconnect(), target.$disconnect()]);
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
