import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT_DIR = '/Users/gui/querobroapp';
const API_DIST_ENTRY = path.join(ROOT_DIR, 'apps', 'api', 'dist', 'modules', 'deliveries', 'deliveries.service.js');
const NEST_COMMON_ENTRY = path.join(ROOT_DIR, 'apps', 'api', 'node_modules', '@nestjs', 'common', 'index.js');

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
      const nestModule = await import(pathToFileURL(NEST_COMMON_ENTRY).href);
      return {
        DeliveriesService: deliveriesModule.DeliveriesService,
        BadRequestException: nestModule.BadRequestException
      };
    })();
  }
  return compiledModulesPromise;
}

function quotePayload() {
  return {
    mode: 'DELIVERY',
    scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    customer: {
      name: 'Cliente teste',
      phone: '11999998888',
      address: 'Avenida Tambore, 123 - Barueri - SP, Brasil',
      placeId: 'place_test',
      lat: -23.5001,
      lng: -46.8501
    },
    manifest: {
      items: [{ name: 'Tradicional', quantity: 1 }],
      subtotal: 42,
      totalUnits: 7
    }
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

test('delivery quotes charge R$ 12 when Uber stays within the base tier', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  service.uberProvider = {
    isConfigured: () => true,
    isCoverageLimitError: () => false,
    quote: async () => ({
      provider: 'UBER_DIRECT',
      fee: 9.9,
      currencyCode: 'BRL',
      source: 'UBER_QUOTE',
      status: 'QUOTED',
      providerQuoteId: 'uber-123',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      fallbackReason: null,
      breakdownLabel: 'Uber Envios',
      distanceKm: 4.6
    })
  };

  const quote = await service.quoteDelivery(quotePayload(), { allowManualFallback: false });

  assert.equal(quote.provider, 'UBER_DIRECT');
  assert.equal(quote.source, 'UBER_QUOTE');
  assert.equal(quote.fee, 12);
  assert.equal(quote.breakdownLabel, 'Uber Envios');
  assert.match(String(quote.quoteToken || ''), /^DQ_/);
});

test('delivery quotes keep R$ 12 within 5 km even when Uber returns a higher raw quote', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());

  service.uberProvider = {
    isConfigured: () => true,
    isCoverageLimitError: () => false,
    quote: async () => ({
      provider: 'UBER_DIRECT',
      fee: 14.2,
      currencyCode: 'BRL',
      source: 'UBER_QUOTE',
      status: 'QUOTED',
      providerQuoteId: 'uber-124',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      fallbackReason: null,
      breakdownLabel: 'Uber Envios',
      distanceKm: 4.9
    })
  };

  const quote = await service.quoteDelivery(quotePayload(), { allowManualFallback: false });

  assert.equal(quote.fee, 12);
});

test('delivery quotes charge R$ 18 above 5 km even when the Uber quote is below R$ 12', async () => {
  const { DeliveriesService } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());

  service.uberProvider = {
    isConfigured: () => true,
    isCoverageLimitError: () => false,
    quote: async () => ({
      provider: 'UBER_DIRECT',
      fee: 11.4,
      currencyCode: 'BRL',
      source: 'UBER_QUOTE',
      status: 'QUOTED',
      providerQuoteId: 'uber-125',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      fallbackReason: null,
      breakdownLabel: 'Uber Envios',
      distanceKm: 5.2
    })
  };

  const quote = await service.quoteDelivery(quotePayload(), { allowManualFallback: false });

  assert.equal(quote.fee, 18);
});

test('delivery quotes keep Uber validation errors when the failure is not a coverage limit', async () => {
  const { DeliveriesService, BadRequestException } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const uberError = new BadRequestException({
    code: 'validation_error',
    message: 'Telefone invalido para cotacao no Uber Envios.'
  });

  service.uberProvider = {
    isConfigured: () => true,
    isCoverageLimitError: () => false,
    quote: async () => {
      throw uberError;
    }
  };
  service.localProvider = {
    quote: async () => {
      throw new Error('local fallback should not be used for explicit validation errors');
    }
  };

  await assert.rejects(
    () =>
      service.quoteDelivery(quotePayload(), {
        allowManualFallback: false
      }),
    /Telefone invalido/
  );
});

test('delivery quotes fall back to local pricing when Uber blocks by coverage radius and manual fallback is enabled', async () => {
  const { DeliveriesService, BadRequestException } = await loadApiModules();
  const service = new DeliveriesService(createPrismaStub());
  const uberError = new BadRequestException({
    code: 'address_undeliverable',
    message: 'outside coverage',
    metadata: {
      details: 'Max Radius: 3.11 miles, Calculated Distance: 7.29 miles'
    }
  });

  service.uberProvider = {
    isConfigured: () => true,
    isCoverageLimitError: (error) => error === uberError,
    quote: async () => {
      throw uberError;
    }
  };
  service.localProvider = {
    quote: async () => ({
      provider: 'LOCAL',
      fee: 12,
      currencyCode: 'BRL',
      source: 'MANUAL_FALLBACK',
      status: 'FALLBACK',
      providerQuoteId: null,
      expiresAt: null,
      fallbackReason: 'Cobertura Uber indisponivel.',
      breakdownLabel: 'Frete provisório',
      distanceKm: null
    })
  };

  const quote = await service.quoteDelivery(quotePayload(), { allowManualFallback: true });

  assert.equal(quote.provider, 'LOCAL');
  assert.equal(quote.source, 'MANUAL_FALLBACK');
  assert.equal(quote.fee, 18);
});
