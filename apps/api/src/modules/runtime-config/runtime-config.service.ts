import { Injectable } from '@nestjs/common';
import { BuilderConfigSchema, type BuilderConfig } from '@querobroapp/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..', '..');
const configuredStorageDir = (process.env.BUILDER_STORAGE_DIR || '').trim();
const DATA_DIR = configuredStorageDir || path.join(repoRoot, 'data', 'builder');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads', 'home');

@Injectable()
export class RuntimeConfigService {
  async getConfig() {
    return this.readConfig();
  }

  async readConfig() {
    await this.ensureStorage();

    const raw = await fs.readFile(CONFIG_PATH, 'utf8').catch(() => '');
    if (!raw) {
      const fallback = BuilderConfigSchema.parse({ version: 1, updatedAt: new Date().toISOString() });
      await this.writeConfig(fallback);
      return fallback;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const config = BuilderConfigSchema.parse(parsed);
    const normalized = BuilderConfigSchema.parse({
      ...config,
      version: 1,
      updatedAt: config.updatedAt || new Date().toISOString()
    });

    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      await this.writeConfig(normalized);
    }

    return normalized;
  }

  async writeConfig(config: BuilderConfig) {
    await this.ensureStorage();
    await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }

  async ensureStorage() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  }
}

export { UPLOADS_DIR };
