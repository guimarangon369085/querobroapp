import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BuilderBlockKeyEnum,
  BuilderConfigPatchSchema,
  BuilderConfigSchema,
  BuilderFormsSchema,
  BuilderHomeImageSchema,
  BuilderHomeSchema,
  BuilderIntegrationsSchema,
  BuilderLayoutsPatchSchema,
  BuilderThemeSchema,
  type BuilderConfig,
  type BuilderConfigPatch,
} from '@querobroapp/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..', '..');
const configuredStorageDir = (process.env.BUILDER_STORAGE_DIR || '').trim();
const DATA_DIR = configuredStorageDir || path.join(repoRoot, 'data', 'builder');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads', 'home');
const UPLOADS_PREFIX = '/uploads/builder/home';

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extensionFromMime(mimeType?: string) {
  switch ((mimeType || '').toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return '';
  }
}

function extensionFromFilename(fileName?: string) {
  if (!fileName) return '';
  const ext = path.extname(fileName).replace('.', '').toLowerCase();
  if (!ext) return '';
  if (['jpg', 'jpeg'].includes(ext)) return 'jpg';
  if (['png', 'webp', 'gif'].includes(ext)) return ext;
  return '';
}

function mergeConfig(current: BuilderConfig, patch: BuilderConfigPatch): BuilderConfig {
  const merged = {
    ...current,
    theme: patch.theme ? { ...current.theme, ...patch.theme } : current.theme,
    forms: patch.forms ? { ...current.forms, ...patch.forms } : current.forms,
    home: patch.home ? { ...current.home, ...patch.home } : current.home,
    integrations: patch.integrations
      ? { ...current.integrations, ...patch.integrations }
      : current.integrations,
    layouts: patch.layouts ? { ...current.layouts, ...patch.layouts } : current.layouts
  };
  return BuilderConfigSchema.parse({ ...merged, version: 1, updatedAt: new Date().toISOString() });
}

@Injectable()
export class BuilderService {
  async getConfig() {
    return this.readConfig();
  }

  async updateConfig(payload: unknown) {
    const patch = BuilderConfigPatchSchema.parse(payload);
    const current = await this.readConfig();
    const next = mergeConfig(current, patch);
    await this.writeConfig(next);
    return next;
  }

  async updateBlock(block: unknown, payload: unknown) {
    const blockKey = BuilderBlockKeyEnum.parse(block);

    if (blockKey === 'theme') {
      const parsed = BuilderThemeSchema.partial().parse(payload);
      return this.updateConfig({ theme: parsed });
    }

    if (blockKey === 'forms') {
      const parsed = BuilderFormsSchema.partial().parse(payload);
      return this.updateConfig({ forms: parsed });
    }

    if (blockKey === 'home') {
      const parsed = BuilderHomeSchema.partial().parse(payload);
      return this.updateConfig({ home: parsed });
    }

    if (blockKey === 'layout') {
      const parsed = BuilderLayoutsPatchSchema.parse(payload);
      return this.updateConfig({ layouts: parsed });
    }

    const parsed = BuilderIntegrationsSchema.partial().parse(payload);
    return this.updateConfig({ integrations: parsed });
  }

  async addHomeImage(file: { buffer: Buffer; mimetype?: string; originalname?: string }, alt?: string) {
    if (!file || !file.buffer || !file.buffer.length) {
      throw new BadRequestException('Arquivo de imagem ausente.');
    }
    if (!allowedMime.has((file.mimetype || '').toLowerCase())) {
      throw new BadRequestException('Formato invalido. Envie jpg, png, webp ou gif.');
    }
    if (file.buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Arquivo excede 8MB.');
    }

    const current = await this.readConfig();
    if (current.home.gallery.length >= 12) {
      throw new BadRequestException('Limite de 12 imagens na home atingido.');
    }

    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const ext =
      extensionFromFilename(file.originalname) || extensionFromMime(file.mimetype) || 'jpg';
    const id = `img_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const fileName = `${id}.${ext}`;
    await fs.writeFile(path.join(UPLOADS_DIR, fileName), file.buffer);

    const image = BuilderHomeImageSchema.parse({
      id,
      src: `${UPLOADS_PREFIX}/${fileName}`,
      alt: (alt || '').trim() || `Imagem ${current.home.gallery.length + 1}`,
    });

    const next = mergeConfig(current, {
      home: {
        gallery: [...current.home.gallery, image],
      },
    });
    await this.writeConfig(next);

    return { config: next, image };
  }

  async removeHomeImage(imageId: string) {
    const current = await this.readConfig();
    const image = current.home.gallery.find((entry) => entry.id === imageId);
    if (!image) {
      throw new NotFoundException('Imagem nao encontrada.');
    }

    const nextGallery = current.home.gallery.filter((entry) => entry.id !== imageId);
    const next = mergeConfig(current, {
      home: { gallery: nextGallery },
    });
    await this.writeConfig(next);

    if (image.src.startsWith(`${UPLOADS_PREFIX}/`)) {
      const localName = image.src.replace(`${UPLOADS_PREFIX}/`, '');
      const absolutePath = path.join(UPLOADS_DIR, localName);
      await fs.unlink(absolutePath).catch(() => undefined);
    }

    return next;
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

    // Ensure defaults are always applied after schema evolutions.
    const normalized = BuilderConfigSchema.parse({
      ...config,
      version: 1,
      updatedAt: config.updatedAt || new Date().toISOString(),
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
