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

test('delivery quotes charge 20 from 6 km to 10 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: -23.502,
      lng: FIXED_COORDS.lng
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.fee, 20);
});

test('delivery quotes charge 22 from 11 km to 15 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: -23.457,
      lng: FIXED_COORDS.lng
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.fee, 22);
});

test('delivery quotes charge 25 from 16 km to 20 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: -23.412,
      lng: FIXED_COORDS.lng
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.fee, 25);
});

test('delivery quotes charge 30 from 21 km to 25 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: -23.358,
      lng: FIXED_COORDS.lng
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.fee, 30);
});

test('delivery quotes charge 35 from 26 km to 30 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: -23.313,
      lng: FIXED_COORDS.lng
    }
  });

  const quote = await service.quoteDelivery(payload);

  assert.equal(quote.fee, 35);
});

test('delivery quotes reject addresses above 30 km', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const payload = quotePayload({
    customer: {
      lat: -23.277,
      lng: FIXED_COORDS.lng
    }
  });

  await assert.rejects(() => service.quoteDelivery(payload), {
    message: 'FORA DA ÁREA DE ENTREGA'
  });
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

test('delivery quotes honor injected pricing config', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub(), {
    getConfig: async () => ({
      tiers: [{ maxKm: 2, fee: 99 }],
      fallbackWithoutCoordinatesFee: 7,
      outOfAreaMessage: 'SEM COBERTURA',
      updatedAt: '2026-04-02T00:00:00.000Z'
    }),
    updateConfig: async () => {
      throw new Error('not used');
    }
  });

  const quote = await service.quoteDelivery(
    quotePayload({
      customer: {
        lat: null,
        lng: null
      }
    })
  );

  assert.equal(quote.fee, 7);

  await assert.rejects(
    () =>
      service.quoteDelivery(
        quotePayload({
          customer: {
            lat: -23.4,
            lng: -46.5
          }
        })
      ),
    { message: 'SEM COBERTURA' }
  );
});
