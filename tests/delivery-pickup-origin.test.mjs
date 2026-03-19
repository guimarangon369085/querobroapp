import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT_DIR = '/Users/gui/querobroapp';
const API_DIST_DIR = path.join(ROOT_DIR, 'apps', 'api', 'dist', 'modules', 'deliveries');

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

async function loadModules() {
  if (!compiledModulesPromise) {
    compiledModulesPromise = (async () => {
      runCommand('pnpm', ['--filter', '@querobroapp/shared', 'build']);
      runCommand('pnpm', ['--filter', '@querobroapp/api', 'build']);

      const [uberModule, deliveriesModule, pickupOriginModule] = await Promise.all([
        import(pathToFileURL(path.join(API_DIST_DIR, 'uber-direct.provider.js')).href),
        import(pathToFileURL(path.join(API_DIST_DIR, 'deliveries.service.js')).href),
        import(pathToFileURL(path.join(API_DIST_DIR, 'pickup-origin.js')).href)
      ]);

      return {
        DeliveriesService: deliveriesModule.DeliveriesService,
        UberDirectProvider: uberModule.UberDirectProvider,
        FIXED_PICKUP_ORIGIN: pickupOriginModule.FIXED_PICKUP_ORIGIN
      };
    })();
  }

  return compiledModulesPromise;
}

function createInput(overrides = {}) {
  return {
    pickupName: 'QUEROBROAPP',
    pickupPhone: '11999999999',
    pickupAddress: 'Rua Errada, 123 - Sao Paulo - SP, Brasil',
    dropoffName: 'Cliente Teste',
    dropoffPhone: '11911112222',
    dropoffAddress: 'Alameda Rio Negro, 500 - Barueri - SP, Brasil',
    dropoffPlaceId: 'place_test',
    dropoffLat: -23.5057,
    dropoffLng: -46.8349,
    scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    orderTotal: 89.9,
    totalUnits: 7,
    manifestSummary: '1 caixa',
    items: [{ name: 'Caixa Tradicional', quantity: 1 }],
    ...overrides
  };
}

test('Uber quote payload always uses Alameda Jau 731 as pickup origin and customer address as dropoff', async () => {
  const { UberDirectProvider, FIXED_PICKUP_ORIGIN } = await loadModules();
  process.env.UBER_DIRECT_API_MODE = 'LEGACY_CUSTOMER';
  process.env.UBER_DIRECT_CUSTOMER_ID = 'customer_test';

  const provider = new UberDirectProvider();
  const payload = provider.buildQuotePayload(createInput());

  assert.equal(payload.pickup_address, FIXED_PICKUP_ORIGIN.fullAddress);
  assert.equal(payload.dropoff_address, 'Alameda Rio Negro, 500 - Barueri - SP, Brasil');
});

test('pickup origin ignores legacy Loggi env and never falls back to PIX key', async () => {
  const { DeliveriesService } = await loadModules();
  const previousEnv = {
    DELIVERY_PICKUP_PHONE: process.env.DELIVERY_PICKUP_PHONE,
    UBER_DIRECT_PICKUP_PHONE: process.env.UBER_DIRECT_PICKUP_PHONE,
    LOGGI_PICKUP_PHONE: process.env.LOGGI_PICKUP_PHONE,
    PIX_STATIC_KEY: process.env.PIX_STATIC_KEY
  };

  process.env.DELIVERY_PICKUP_PHONE = '';
  process.env.UBER_DIRECT_PICKUP_PHONE = '';
  process.env.LOGGI_PICKUP_PHONE = '11988887777';
  process.env.PIX_STATIC_KEY = 'pix-chave@querobroa.com.br';

  try {
    const service = new DeliveriesService({});
    const pickupOrigin = service.pickupOrigin();
    assert.equal(pickupOrigin.phone, '');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
