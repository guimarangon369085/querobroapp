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

test('delivery quotes fall back to Loggi when Uber blocks by coverage radius', async () => {
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
  service.loggiProvider = {
    isConfigured: () => true,
    quote: async () => ({
      provider: 'LOGGI',
      fee: 24.76,
      currencyCode: 'BRL',
      source: 'LOGGI_QUOTE',
      status: 'QUOTED',
      providerQuoteId: 'loggi-123',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      fallbackReason: null,
      breakdownLabel: 'Loggi'
    })
  };
  service.localProvider = {
    quote: async () => {
      throw new Error('local fallback should not be used when Loggi can quote');
    }
  };

  const quote = await service.quoteDelivery(quotePayload(), {
    allowManualFallback: false
  });

  assert.equal(quote.provider, 'LOGGI');
  assert.equal(quote.source, 'LOGGI_QUOTE');
  assert.equal(quote.fee, 24.76);
  assert.equal(quote.breakdownLabel, 'Loggi');
  assert.match(String(quote.quoteToken || ''), /^DQ_/);
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
  service.loggiProvider = {
    isConfigured: () => true,
    quote: async () => {
      throw new Error('Loggi should not be called when Uber fails for another validation reason');
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
