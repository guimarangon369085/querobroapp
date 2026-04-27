import { Injectable } from '@nestjs/common';
import { DeliveryPricingConfigSchema, roundMoney } from '@querobroapp/shared';
import type { DeliveryPricingConfig } from '@querobroapp/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DELIVERY_PRICING_CONFIG: DeliveryPricingConfig = {
  tiers: [
    { maxKm: 5, fee: 12 },
    { maxKm: 10, fee: 20 },
    { maxKm: 15, fee: 22 },
    { maxKm: 20, fee: 25 },
    { maxKm: 25, fee: 30 },
    { maxKm: 30, fee: 35 }
  ],
  fallbackWithoutCoordinatesFee: 12,
  outOfAreaMessage: 'FORA DA ÁREA DE ENTREGA',
  updatedAt: null
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..', '..');
const configuredStorageDir = (process.env.BUILDER_STORAGE_DIR || '').trim();
const DATA_DIR = configuredStorageDir || path.join(repoRoot, 'data', 'builder');
const CONFIG_PATH = path.join(DATA_DIR, 'delivery-pricing.json');
const DELIVERY_PRICING_CONFIG_SEED_JSON = (process.env.DELIVERY_PRICING_CONFIG_SEED_JSON || '').trim();

function readSeedConfig(): DeliveryPricingConfig | null {
  if (!DELIVERY_PRICING_CONFIG_SEED_JSON) return null;
  try {
    const parsed = JSON.parse(DELIVERY_PRICING_CONFIG_SEED_JSON);
    return DeliveryPricingConfigSchema.parse(parsed);
  } catch (error) {
    console.error(
      '[delivery-pricing-config] invalid DELIVERY_PRICING_CONFIG_SEED_JSON, using default config',
      error
    );
    return null;
  }
}

@Injectable()
export class DeliveryPricingConfigService {
  async getConfig() {
    return this.readConfig();
  }

  async updateConfig(input: unknown) {
    const parsed = DeliveryPricingConfigSchema.parse(input);
    const normalized = this.normalizeConfig(parsed, new Date().toISOString());
    await this.writeConfig(normalized);
    return normalized;
  }

  async readConfig() {
    await this.ensureStorage();
    const raw = await fs.readFile(CONFIG_PATH, 'utf8').catch(() => '');
    if (!raw) {
      const fallback = this.normalizeConfig(
        readSeedConfig() || DEFAULT_DELIVERY_PRICING_CONFIG,
        new Date().toISOString()
      );
      await this.writeConfig(fallback);
      return fallback;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = DEFAULT_DELIVERY_PRICING_CONFIG;
    }

    const normalized = this.normalizeConfig(DeliveryPricingConfigSchema.parse(parsed), undefined);
    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      await this.writeConfig(normalized);
    }
    return normalized;
  }

  private normalizeConfig(config: DeliveryPricingConfig, updatedAtOverride?: string) {
    const tiers = Array.from(
      new Map(
        config.tiers
          .map((tier) => ({
            maxKm: Math.max(Number(tier.maxKm) || 0, 0.1),
            fee: roundMoney(Math.max(Number(tier.fee) || 0, 0))
          }))
          .sort((left, right) => left.maxKm - right.maxKm)
          .map((tier) => [Number(tier.maxKm.toFixed(2)), tier] as const)
      ).values()
    );

    return DeliveryPricingConfigSchema.parse({
      tiers,
      fallbackWithoutCoordinatesFee: roundMoney(Math.max(Number(config.fallbackWithoutCoordinatesFee) || 0, 0)),
      outOfAreaMessage: String(config.outOfAreaMessage || '').trim() || DEFAULT_DELIVERY_PRICING_CONFIG.outOfAreaMessage,
      updatedAt: updatedAtOverride ?? config.updatedAt ?? new Date().toISOString()
    });
  }

  async writeConfig(config: DeliveryPricingConfig) {
    await this.ensureStorage();
    await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }

  private async ensureStorage() {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}
