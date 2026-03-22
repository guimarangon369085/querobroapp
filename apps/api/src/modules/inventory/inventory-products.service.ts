import { Injectable, NotFoundException, Inject, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ProductSchema } from '@querobroapp/shared';
import { normalizeMoney, normalizeText, normalizeTitle } from '../../common/normalize.js';
import { PrismaService } from '../../prisma.service.js';
import { normalizeInventoryLookup } from './inventory-formulas.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TRADITIONAL_BROA_TEMPLATE_KEY = normalizeInventoryLookup('Broa Tradicional');
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..', '..');
const configuredStorageDir = (process.env.BUILDER_STORAGE_DIR || '').trim();
const DATA_DIR = configuredStorageDir || path.join(repoRoot, 'data', 'builder');
const PRODUCT_UPLOADS_DIR = path.join(DATA_DIR, 'uploads', 'products');
const PRODUCT_UPLOADS_PREFIX = '/uploads/products';
const PRODUCT_IMAGE_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extensionFromMime(mimeType?: string | null) {
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

function extensionFromFilename(fileName?: string | null) {
  if (!fileName) return '';
  const ext = path.extname(fileName).replace('.', '').toLowerCase();
  if (!ext) return '';
  if (ext === 'jpeg') return 'jpg';
  return ['jpg', 'png', 'webp', 'gif'].includes(ext) ? ext : '';
}

function isSafeManagedProductImageName(fileName?: string | null) {
  const normalized = (fileName || '').trim();
  if (!normalized || normalized !== path.basename(normalized)) return false;
  return /^prd_[a-z0-9]{16}\.(jpg|png|webp|gif)$/i.test(normalized);
}

@Injectable()
export class InventoryProductsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private normalizeProductImageUrl(value?: string | null) {
    return normalizeText(value ?? undefined) ?? null;
  }

  private async ensureImageStorage() {
    await fs.mkdir(PRODUCT_UPLOADS_DIR, { recursive: true });
  }

  private async removeManagedProductImageIfUnused(params: {
    imageUrl?: string | null;
    ignoredProductId?: number | null;
  }) {
    const normalizedImageUrl = this.normalizeProductImageUrl(params.imageUrl);
    if (!normalizedImageUrl?.startsWith(`${PRODUCT_UPLOADS_PREFIX}/`)) return;

    const fileName = normalizedImageUrl.replace(`${PRODUCT_UPLOADS_PREFIX}/`, '');
    if (!isSafeManagedProductImageName(fileName)) return;

    const otherProductsCount = await this.prisma.product.count({
      where: {
        imageUrl: normalizedImageUrl,
        ...(typeof params.ignoredProductId === 'number'
          ? { id: { not: params.ignoredProductId } }
          : {})
      }
    });
    if (otherProductsCount > 0) return;

    const absolutePath = path.join(PRODUCT_UPLOADS_DIR, fileName);
    const relative = path.relative(PRODUCT_UPLOADS_DIR, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;

    await fs.unlink(absolutePath).catch(() => undefined);
  }

  private isTraditionalBroaTemplateName(value: string | null | undefined) {
    if (!value) return false;
    return normalizeInventoryLookup(value).startsWith(TRADITIONAL_BROA_TEMPLATE_KEY);
  }

  private async findTraditionalBroaTemplateBom(tx: Prisma.TransactionClient) {
    const activeCandidates = await tx.bom.findMany({
      include: {
        items: true,
        product: true
      },
      where: {
        product: {
          active: true
        }
      },
      orderBy: { id: 'desc' }
    });

    const activeTemplate = activeCandidates.find((candidate) =>
      this.isTraditionalBroaTemplateName(candidate.product?.name || candidate.name)
    );
    if (activeTemplate) return activeTemplate;

    const fallbackCandidates = await tx.bom.findMany({
      include: {
        items: true,
        product: true
      },
      orderBy: { id: 'desc' }
    });

    return (
      fallbackCandidates.find((candidate) =>
        this.isTraditionalBroaTemplateName(candidate.product?.name || candidate.name)
      ) || null
    );
  }

  private async ensureDefaultBom(
    tx: Prisma.TransactionClient,
    product: { id: number; name: string; unit: string | null }
  ) {
    const existing = await tx.bom.findFirst({
      where: { productId: product.id },
      orderBy: { id: 'asc' }
    });
    if (existing) return existing;

    const template = await this.findTraditionalBroaTemplateBom(tx);

    return tx.bom.create({
      data: {
        productId: product.id,
        name: product.name,
        saleUnitLabel: template?.saleUnitLabel ?? product.unit,
        yieldUnits: template?.yieldUnits ?? null,
        items: template?.items?.length
          ? {
              create: template.items.map((item) => ({
                itemId: item.itemId,
                qtyPerRecipe: item.qtyPerRecipe ?? null,
                qtyPerSaleUnit: item.qtyPerSaleUnit ?? null,
                qtyPerUnit: item.qtyPerUnit ?? null
              }))
            }
          : undefined
      }
    });
  }

  list() {
    return this.prisma.product.findMany({ orderBy: { id: 'desc' } });
  }

  async get(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto nao encontrado');
    return product;
  }

  async uploadImage(
    file:
      | {
          buffer?: Buffer;
          mimetype?: string;
          originalname?: string;
          size?: number;
        }
      | undefined
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Arquivo de imagem ausente.');
    }
    if (!PRODUCT_IMAGE_ALLOWED_MIME.has((file.mimetype || '').toLowerCase())) {
      throw new BadRequestException('Formato invalido. Envie jpg, png, webp ou gif.');
    }
    if (file.buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Arquivo excede 8MB.');
    }

    await this.ensureImageStorage();
    const ext = extensionFromFilename(file.originalname) || extensionFromMime(file.mimetype) || 'jpg';
    const id = `prd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const fileName = `${id}.${ext}`;
    await fs.writeFile(path.join(PRODUCT_UPLOADS_DIR, fileName), file.buffer);

    return {
      imageUrl: `${PRODUCT_UPLOADS_PREFIX}/${fileName}`
    };
  }

  create(payload: unknown) {
    const data = ProductSchema.omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...data,
          name: normalizeTitle(data.name) ?? data.name,
          category: normalizeTitle(data.category ?? undefined),
          unit: normalizeText(data.unit ?? undefined)?.toLowerCase() ?? data.unit ?? null,
          price: normalizeMoney(data.price),
          imageUrl: this.normalizeProductImageUrl(data.imageUrl)
        }
      });

      await this.ensureDefaultBom(tx, {
        id: created.id,
        name: created.name,
        unit: created.unit ?? null
      });

      return created;
    });
  }

  async update(id: number, payload: unknown) {
    const current = await this.get(id);
    const data = ProductSchema.partial().omit({ id: true, createdAt: true }).parse(payload);
    const nextImageUrl =
      data.imageUrl !== undefined ? this.normalizeProductImageUrl(data.imageUrl) : undefined;
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        name: data.name ? normalizeTitle(data.name) ?? data.name : undefined,
        category: data.category !== undefined ? normalizeTitle(data.category ?? undefined) : undefined,
        unit: data.unit !== undefined ? normalizeText(data.unit ?? undefined)?.toLowerCase() ?? null : undefined,
        price: data.price !== undefined ? normalizeMoney(data.price) : undefined,
        imageUrl: nextImageUrl
      }
    });

    if (nextImageUrl !== undefined && nextImageUrl !== current.imageUrl) {
      await this.removeManagedProductImageIfUnused({
        imageUrl: current.imageUrl,
        ignoredProductId: id
      });
    }

    return updated;
  }

  async remove(id: number) {
    const product = await this.get(id);
    const [itemsCount, bomsCount] = await this.prisma.$transaction([
      this.prisma.orderItem.count({ where: { productId: id } }),
      this.prisma.bom.count({ where: { productId: id } })
    ]);

    if (itemsCount > 0 || bomsCount > 0) {
      await this.prisma.product.update({
        where: { id },
        data: { active: false }
      });
      return { archived: true };
    }

    await this.prisma.product.delete({ where: { id } });
    await this.removeManagedProductImageIfUnused({ imageUrl: product.imageUrl });
    return { deleted: true };
  }
}

export { PRODUCT_UPLOADS_DIR };
