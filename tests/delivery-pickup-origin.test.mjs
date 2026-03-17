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

      const [uberModule, loggiModule, pickupOriginModule] = await Promise.all([
        import(pathToFileURL(path.join(API_DIST_DIR, 'uber-direct.provider.js')).href),
        import(pathToFileURL(path.join(API_DIST_DIR, 'loggi.provider.js')).href),
        import(pathToFileURL(path.join(API_DIST_DIR, 'pickup-origin.js')).href)
      ]);

      return {
        UberDirectProvider: uberModule.UberDirectProvider,
        LoggiProvider: loggiModule.LoggiProvider,
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

test('Loggi quote and shipment payloads always use Alameda Jau 731 as pickup origin', async () => {
  const { LoggiProvider, FIXED_PICKUP_ORIGIN } = await loadModules();
  process.env.LOGGI_PICKUP_POSTAL_CODE = '01420-004';
  process.env.LOGGI_PICKUP_ADDRESS_LINE1 = 'Rua Errada, 123';
  process.env.LOGGI_PICKUP_CITY = 'Campinas';
  process.env.LOGGI_PICKUP_STATE = 'RJ';
  process.env.LOGGI_PICKUP_COUNTRY = 'Argentina';

  const provider = new LoggiProvider();
  const input = createInput();
  const quotePayload = provider.buildQuotePayload(input);
  const lineAddress = provider.resolvePickupLineAddress();

  assert.equal(quotePayload.shipFrom.widget.address, FIXED_PICKUP_ORIGIN.fullAddress);
  assert.equal(quotePayload.shipTo.widget.address, input.dropoffAddress);
  assert.equal(lineAddress.addressLine1, FIXED_PICKUP_ORIGIN.addressLine1);
  assert.equal(lineAddress.city, FIXED_PICKUP_ORIGIN.city);
  assert.equal(lineAddress.state, FIXED_PICKUP_ORIGIN.state);
  assert.equal(lineAddress.country, FIXED_PICKUP_ORIGIN.country);
  assert.equal(lineAddress.postalCode, '01420004');
});
