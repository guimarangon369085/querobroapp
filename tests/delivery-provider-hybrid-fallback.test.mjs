import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT_DIR = '/Users/gui/querobroapp';
const API_DIST_ENTRY = path.join(ROOT_DIR, 'apps', 'api', 'dist', 'modules', 'deliveries', 'deliveries.service.js');

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [String(result.stdout || '').trim(), String(result.stderr || '').trim()].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} falhou com status ${result.status}${detail ? `\n${detail}` : ''}`);
  }
}

let compiledModulesPromise = null;

async function loadApiModules() {
  if (!compiledModulesPromise) {
    compiledModulesPromise = (async () => {
      runCommand('pnpm', ['--filter', '@querobroapp/shared', 'build']);
      runCommand('pnpm', ['--filter', '@querobroapp/api', 'build']);
      const deliveriesModule = await import(pathToFileURL(API_DIST_ENTRY).href);
      return {
        DeliveriesService: deliveriesModule.DeliveriesService
      };
    })();
  }
  return compiledModulesPromise;
}

function quotePayload(overrides = {}) {
  const {
    customer: customerOverrides = {},
    manifest: manifestOverrides = {},
    ...restOverrides
  } = overrides;

  return {
    mode: 'DELIVERY',
    scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    customer: {
      name: 'Cliente teste',
      phone: '11999998888',
      address: 'Avenida Tambore, 123 - Barueri - SP, Brasil',
      placeId: 'place_test',
      lat: -23.5001,
      lng: -46.8501,
      ...customerOverrides
    },
    manifest: {
      items: [{ name: 'Tradicional', quantity: 1 }],
      subtotal: 42,
      totalUnits: 7,
      ...manifestOverrides
    },
    ...restOverrides
  };
}

function createPrismaStub() {
  return {
    idempotencyRecord: {
      findUnique: async () => null,
      upsert: async () => null
    }
  };
}

const FIXED_COORDS = {
  lat: -23.5650452,
  lng: -46.6562471
};

test('delivery quotes charge 12 within 5 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: FIXED_COORDS.lat,
      lng: FIXED_COORDS.lng
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.provider, 'LOCAL');
  assert.equal(quote.source, 'MANUAL_FALLBACK');
  assert.equal(quote.fee, 12);
  assert.equal(quote.breakdownLabel, null);
  assert.match(String(quote.quoteToken || ''), /^DQ_/);
});

test('delivery quotes charge 18 above 5 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: -23.4,
      lng: -46.5
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.fee, 18);
});

test('delivery quotes fall back to base rate when coordinates missing', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: null,
      lng: null
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.fee, 12);
});
