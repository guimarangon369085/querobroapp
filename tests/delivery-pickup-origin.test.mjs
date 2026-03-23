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
      const [deliveriesModule, pickupOriginModule] = await Promise.all([
        import(pathToFileURL(path.join(API_DIST_DIR, 'deliveries.service.js')).href),
        import(pathToFileURL(path.join(API_DIST_DIR, 'pickup-origin.js')).href)
      ]);
      return {
        DeliveriesService: deliveriesModule.DeliveriesService,
        FIXED_PICKUP_ORIGIN: pickupOriginModule.FIXED_PICKUP_ORIGIN
      };
    })();
  }
  return compiledModulesPromise;
}

test('pickup origin honors DELIVERY_PICKUP_* overrides', async () => {
  const previousName = process.env.DELIVERY_PICKUP_NAME;
  const previousPhone = process.env.DELIVERY_PICKUP_PHONE;
  process.env.DELIVERY_PICKUP_NAME = 'Operacional Broa';
  process.env.DELIVERY_PICKUP_PHONE = '11900001111';

  try {
    const { DeliveriesService } = await loadModules();
    const service = new DeliveriesService({});
    const pickupOrigin = service.pickupOrigin();

    assert.equal(pickupOrigin.name, 'Operacional Broa');
    assert.equal(pickupOrigin.phone, '11900001111');
  } finally {
    if (previousName == null) delete process.env.DELIVERY_PICKUP_NAME;
    else process.env.DELIVERY_PICKUP_NAME = previousName;
    if (previousPhone == null) delete process.env.DELIVERY_PICKUP_PHONE;
    else process.env.DELIVERY_PICKUP_PHONE = previousPhone;
  }
});

test('pickup origin address matches fixed origin', async () => {
  const { DeliveriesService, FIXED_PICKUP_ORIGIN } = await loadModules();
  const service = new DeliveriesService({});
  const pickupOrigin = service.pickupOrigin();
  assert.strictEqual(pickupOrigin.address, FIXED_PICKUP_ORIGIN.fullAddress);
});
