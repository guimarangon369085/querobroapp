import { Injectable, NotFoundException, Inject, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ProductSchema } from '@querobroapp/shared';
import { normalizeMoney, normalizeText, normalizeTitle } from '../../common/normalize.js';
import { PrismaService } from '../../prisma.service.js';
import { normalizeInventoryLookup } from './inventory-formulas.js';
import { syncCompanionProductActiveStateByItemIds } from './companion-product-availability.js';
import { loadProductSalesLimitStates } from './product-sales-limit.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TRADITIONAL_BROA_TEMPLATE_KEY = normalizeInventoryLookup('Broa Tradicional');
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..', '..');
const configuredStorageDir = (process.env.BUILDER_STORAGE_DIR || '').trim();
const DATA_DIR = configuredStorageDir || path.join(repoRoot, 'data', 'builder');
const PRODUCT_UPLOADS_DIR = path.join(DATA_DIR, 'uploads', 'products');
const PRODUCT_UPLOADS_PREFIX = '/uploads/products';
const PRODUCT_IMAGE_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const PRODUCT_IMAGE_MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const PRODUCT_IMAGE_MAX_WIDTH = 1600;
const PRODUCT_IMAGE_MAX_HEIGHT = 1600;
const PRODUCT_IMAGE_OUTPUT_QUALITY = 82;
const BROA_CATALOG_CATEGORY_KEY = normalizeInventoryLookup('Sabores');
const COMPANION_CATALOG_CATEGORY_KEYS = new Set([
  normalizeInventoryLookup('Amigos da Broa'),
  normalizeInventoryLookup('Amigas da Broa')
]);
const MEASURE_UNITS = new Set(['mg', 'g', 'kg', 'ml', 'l']);
const ROMEU_E_JULIETA_CARDAPIO_IMAGE = '/querobroa-brand/cardapio/romeu-e-julieta.jpg?v=20260414-rj2';
const SABORES_CARDAPIO_IMAGE = '/querobroa-brand/cardapio/sabores-caixa.jpg?v=20260414-rj2';

function isSafeManagedProductImageName(fileName?: string | null) {
  const normalized = (fileName || '').trim();
  if (!normalized || normalized !== path.basename(normalized)) return false;
  return /^prd_[a-z0-9]{16}\.(jpg|png|webp|gif)$/i.test(normalized);
}

function resolveCanonicalCatalogImageByProductName(productName?: string | null) {
  const normalized = normalizeInventoryLookup(productName ?? '');
  if (!normalized) return null;

  if (normalized.includes('ROMEU') || normalized.includes('JULIETA')) {
    return ROMEU_E_JULIETA_CARDAPIO_IMAGE;
  }
  if (normalized.includes('MISTA') && normalized.includes('GOIABADA')) {
    return '/querobroa-brand/cardapio/mista-goiabada.jpg';
  }
  if (normalized.includes('MISTA') && normalized.includes('DOCE DE LEITE')) {
    return '/querobroa-brand/cardapio/mista-doce-de-leite.jpg';
  }
  if (normalized.includes('MISTA') && normalized.includes('QUEIJO')) {
    return '/querobroa-brand/cardapio/mista-queijo-do-serro.jpg';
  }
  if (normalized.includes('MISTA') && normalized.includes('REQUEIJAO')) {
    return '/querobroa-brand/cardapio/mista-requeijao-de-corte.jpg';
  }
  if (normalized.includes('TRADICIONAL')) {
    return '/querobroa-brand/cardapio/tradicional.jpg';
  }
  if (normalized.includes('GOIABADA')) {
    return '/querobroa-brand/cardapio/goiabada.jpg';
  }
  if (normalized.includes('DOCE DE LEITE')) {
    return '/querobroa-brand/cardapio/doce-de-leite.jpg';
  }
  if (normalized.includes('REQUEIJAO')) {
    return '/querobroa-brand/cardapio/requeijao-de-corte.jpg';
  }
  if (normalized.includes('QUEIJO')) {
    return '/querobroa-brand/cardapio/queijo-do-serro-camadas.jpg';
  }
  if (normalized.includes('SABORES')) {
    return SABORES_CARDAPIO_IMAGE;
  }

  return null;
}

function isCanonicalCatalogCategory(category?: string | null) {
  return normalizeInventoryLookup(category ?? '') === BROA_CATALOG_CATEGORY_KEY;
}

function isCompanionCatalogCategory(category?: string | null) {
  return COMPANION_CATALOG_CATEGORY_KEYS.has(normalizeInventoryLookup(category ?? ''));
}

@Injectable()
export class InventoryProductsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toQty(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 10000) / 10000;
  }

  private roundMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private productSchemaForWrite() {
    return ProductSchema.omit({
      id: true,
      createdAt: true,
      measureLabel: true,
      salesLimitActivatedAt: true,
      salesLimitConsumedBoxes: true,
      salesLimitRemainingBoxes: true,
      salesLimitExhausted: true
    });
  }

  private normalizeProductImageUrl(value?: string | null) {
    return normalizeText(value ?? undefined) ?? null;
  }

  private normalizeDrawerNote(value?: string | null) {
    if (typeof value !== 'string') return null;

    const normalizedLines = value
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    return normalizedLines.length ? normalizedLines.join('\n') : null;
  }

  private buildBalanceByItemId(
    movements: Array<{
      itemId: number;
      type: string;
      quantity: number;
    }>
  ) {
    const balanceByItem = new Map<number, number>();

    for (const movement of movements) {
      const current = balanceByItem.get(movement.itemId) || 0;
      if (movement.type === 'IN') {
        balanceByItem.set(movement.itemId, this.toQty(current + movement.quantity));
      } else if (movement.type === 'OUT') {
        balanceByItem.set(movement.itemId, this.toQty(current - movement.quantity));
      } else if (movement.type === 'ADJUST') {
        balanceByItem.set(movement.itemId, this.toQty(movement.quantity));
      }
    }

    return balanceByItem;
  }

  private async createPriceEntryIfChanged(
    client: Prisma.TransactionClient | PrismaService,
    params: {
      itemId: number;
      purchasePackSize: number;
      purchasePackCost: number;
      effectiveAt: Date;
      sourceName?: string | null;
      sourceUrl?: string | null;
      note?: string | null;
    }
  ) {
    const previous = await client.inventoryPriceEntry.findFirst({
      where: { itemId: params.itemId },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }]
    });

    if (
      previous &&
      Math.abs((previous.purchasePackCost || 0) - params.purchasePackCost) < 0.01 &&
      Math.abs((previous.purchasePackSize || 0) - params.purchasePackSize) < 0.0001 &&
      previous.effectiveAt.getTime() === params.effectiveAt.getTime() &&
      (previous.sourceName || null) === (params.sourceName || null) &&
      (previous.sourceUrl || null) === (params.sourceUrl || null) &&
      (previous.note || null) === (params.note || null)
    ) {
      return previous;
    }

    return client.inventoryPriceEntry.create({
      data: {
        itemId: params.itemId,
        purchasePackSize: params.purchasePackSize,
        purchasePackCost: params.purchasePackCost,
        sourceName: params.sourceName || null,
        sourceUrl: params.sourceUrl || null,
        note: params.note || null,
        effectiveAt: params.effectiveAt
      }
    });
  }

  private async ensureCanonicalInventoryItemUniqueness(params: {
    id?: number;
    name: string;
    category: string;
    unit: string;
  }) {
    const canonicalName = normalizeText(params.name) ?? params.name.trim();
    const duplicate = await this.prisma.inventoryItem.findFirst({
      where: {
        ...(typeof params.id === 'number' ? { id: { not: params.id } } : {}),
        name: canonicalName,
        category: params.category,
        unit: params.unit
      },
      orderBy: { id: 'asc' }
    });

    if (duplicate) {
      throw new BadRequestException(`Ja existe um item de estoque oficial para ${canonicalName}.`);
    }

    return canonicalName;
  }

  private async enrichProductsWithCompanionInventory<
    T extends {
      category: string | null;
      inventoryItemId?: number | null;
      inventoryQtyPerSaleUnit?: number | null;
    }
  >(tx: Prisma.TransactionClient | PrismaService, products: T[]) {
    const companionInventoryItemIds = Array.from(
      new Set(
        products
          .filter((product) => isCompanionCatalogCategory(product.category ?? ''))
          .map((product) => product.inventoryItemId ?? null)
          .filter((value): value is number => typeof value === 'number' && value > 0)
      )
    );

    if (companionInventoryItemIds.length === 0) {
      return products.map((product) => ({
        ...product,
        companionInventory: null
      }));
    }

    const [inventoryItems, movements, priceEntries] = await Promise.all([
      tx.inventoryItem.findMany({
        where: {
          id: {
            in: companionInventoryItemIds
          }
        },
        select: {
          id: true,
          unit: true,
          purchasePackSize: true,
          purchasePackCost: true,
          leadTimeDays: true,
          safetyStockQty: true,
          reorderPointQty: true,
          targetStockQty: true,
          perishabilityDays: true,
          criticality: true,
          preferredSupplier: true
        },
        orderBy: { id: 'asc' }
      }),
      tx.inventoryMovement.findMany({
        where: {
          itemId: {
            in: companionInventoryItemIds
          }
        },
        select: {
          itemId: true,
          type: true,
          quantity: true
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      }),
      tx.inventoryPriceEntry.findMany({
        where: {
          itemId: {
            in: companionInventoryItemIds
          }
        },
        select: {
          itemId: true,
          sourceName: true,
          sourceUrl: true,
          effectiveAt: true,
          id: true
        },
        orderBy: [{ itemId: 'asc' }, { effectiveAt: 'desc' }, { id: 'desc' }]
      })
    ]);

    const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
    const balanceByItemId = this.buildBalanceByItemId(movements);
    const latestPriceEntryByItemId = new Map<
      number,
      {
        sourceName: string | null;
        sourceUrl: string | null;
      }
    >();
    for (const entry of priceEntries) {
      if (!latestPriceEntryByItemId.has(entry.itemId)) {
        latestPriceEntryByItemId.set(entry.itemId, {
          sourceName: entry.sourceName || null,
          sourceUrl: entry.sourceUrl || null
        });
      }
    }

    return products.map((product) => {
      const inventoryItemId = product.inventoryItemId ?? null;
      const item =
        typeof inventoryItemId === 'number' && inventoryItemId > 0
          ? itemById.get(inventoryItemId) || null
          : null;
      const latestPriceEntry =
        typeof inventoryItemId === 'number' && inventoryItemId > 0
          ? latestPriceEntryByItemId.get(inventoryItemId) || null
          : null;

      return {
        ...product,
        companionInventory: item
          ? {
              balance: this.toQty(balanceByItemId.get(item.id) || 0),
              unit: item.unit,
              purchasePackSize: item.purchasePackSize,
              purchasePackCost: this.roundMoney(item.purchasePackCost || 0),
              sourceName: latestPriceEntry?.sourceName || null,
              sourceUrl: latestPriceEntry?.sourceUrl || null,
              leadTimeDays: item.leadTimeDays ?? null,
              safetyStockQty: item.safetyStockQty ?? null,
              reorderPointQty: item.reorderPointQty ?? null,
              targetStockQty: item.targetStockQty ?? null,
              perishabilityDays: item.perishabilityDays ?? null,
              criticality: item.criticality ?? null,
              preferredSupplier: item.preferredSupplier ?? null
            }
          : null
      };
    });
  }

  private async syncCompanionInventoryForProduct(
    tx: Prisma.TransactionClient,
    params: {
      productId?: number | null;
      productName: string;
      isCompanionProduct: boolean;
      inventoryItemId?: number | null;
      inventoryQtyPerSaleUnit?: number | null;
      companionInventory?: {
        balance?: number | null;
        unit?: string | null;
        purchasePackSize?: number | null;
        purchasePackCost?: number | null;
        sourceName?: string | null;
        sourceUrl?: string | null;
        leadTimeDays?: number | null;
        safetyStockQty?: number | null;
        reorderPointQty?: number | null;
        targetStockQty?: number | null;
        perishabilityDays?: number | null;
        criticality?: string | null;
        preferredSupplier?: string | null;
      } | null;
    }
  ) {
    if (!params.isCompanionProduct) {
      return {
        inventoryItemId: null as number | null,
        inventoryQtyPerSaleUnit: null as number | null
      };
    }

    if (!params.companionInventory) {
      throw new BadRequestException('Preencha o estoque direto do produto Amigas da Broa.');
    }

    const normalizedStockUnit =
      normalizeText(params.companionInventory.unit ?? undefined)?.toLowerCase() ?? null;
    if (!normalizedStockUnit) {
      throw new BadRequestException('Informe a unidade do estoque do produto Amigas da Broa.');
    }

    const inventoryQtyPerSaleUnit = this.toQty(params.inventoryQtyPerSaleUnit || 0);
    if (!(inventoryQtyPerSaleUnit > 0)) {
      throw new BadRequestException('Informe a gramatura ou consumo por unidade vendida.');
    }

    const purchasePackSize = this.toQty(params.companionInventory.purchasePackSize || 0);
    if (!(purchasePackSize > 0)) {
      throw new BadRequestException('Informe o tamanho do pack do produto Amigas da Broa.');
    }

    const purchasePackCost = this.roundMoney(params.companionInventory.purchasePackCost || 0);
    const requestedBalance = this.toQty(params.companionInventory.balance || 0);
    const sourceName = normalizeText(params.companionInventory.sourceName ?? undefined) ?? null;
    const sourceUrl = normalizeText(params.companionInventory.sourceUrl ?? undefined) ?? null;
    const preferredSupplier =
      normalizeText(params.companionInventory.preferredSupplier ?? undefined) ?? null;

    const currentInventoryItem =
      typeof params.inventoryItemId === 'number' && params.inventoryItemId > 0
        ? await tx.inventoryItem.findUnique({
            where: { id: params.inventoryItemId }
          })
        : null;

    const currentMovements = currentInventoryItem
      ? await tx.inventoryMovement.findMany({
          where: { itemId: currentInventoryItem.id },
          select: { itemId: true, type: true, quantity: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        })
      : [];
    const currentBalance = currentInventoryItem
      ? this.toQty(this.buildBalanceByItemId(currentMovements).get(currentInventoryItem.id) || 0)
      : 0;

    const canonicalItemName = await this.ensureCanonicalInventoryItemUniqueness({
      id: currentInventoryItem?.id,
      name: params.productName,
      category: 'INGREDIENTE',
      unit: normalizedStockUnit
    });

    if (!currentInventoryItem) {
      const createdItem = await tx.inventoryItem.create({
        data: {
          name: canonicalItemName,
          category: 'INGREDIENTE',
          unit: normalizedStockUnit,
          purchasePackSize,
          purchasePackCost,
          leadTimeDays: params.companionInventory.leadTimeDays ?? null,
          safetyStockQty: params.companionInventory.safetyStockQty ?? null,
          reorderPointQty: params.companionInventory.reorderPointQty ?? null,
          targetStockQty: params.companionInventory.targetStockQty ?? null,
          perishabilityDays: params.companionInventory.perishabilityDays ?? null,
          criticality: params.companionInventory.criticality ?? null,
          preferredSupplier
        }
      });

      await this.createPriceEntryIfChanged(tx, {
        itemId: createdItem.id,
        purchasePackSize: createdItem.purchasePackSize,
        purchasePackCost: this.roundMoney(createdItem.purchasePackCost || 0),
        effectiveAt: createdItem.createdAt,
        sourceName,
        sourceUrl,
        note: 'Cadastro inicial via produto Amigas da Broa.'
      });

      if (requestedBalance > 0) {
        await tx.inventoryMovement.create({
          data: {
            itemId: createdItem.id,
            type: 'ADJUST',
            quantity: requestedBalance,
            reason: `Saldo inicial do produto ${params.productName}`,
            source: 'PRODUCT_STOCK_DIRECT',
            sourceLabel: params.productName
          }
        });
      }

      return {
        inventoryItemId: createdItem.id,
        inventoryQtyPerSaleUnit
      };
    }

    const latestPriceEntry = await tx.inventoryPriceEntry.findFirst({
      where: { itemId: currentInventoryItem.id },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }]
    });

    const updatedItem = await tx.inventoryItem.update({
      where: { id: currentInventoryItem.id },
      data: {
        name: canonicalItemName,
        category: 'INGREDIENTE',
        unit: normalizedStockUnit,
        purchasePackSize,
        purchasePackCost,
        leadTimeDays: params.companionInventory.leadTimeDays ?? null,
        safetyStockQty: params.companionInventory.safetyStockQty ?? null,
        reorderPointQty: params.companionInventory.reorderPointQty ?? null,
        targetStockQty: params.companionInventory.targetStockQty ?? null,
        perishabilityDays: params.companionInventory.perishabilityDays ?? null,
        criticality: params.companionInventory.criticality ?? null,
        preferredSupplier
      }
    });

    const priceTouched =
      Math.abs((currentInventoryItem.purchasePackSize || 0) - purchasePackSize) >= 0.0001 ||
      Math.abs((currentInventoryItem.purchasePackCost || 0) - purchasePackCost) >= 0.01 ||
      (latestPriceEntry?.sourceName || null) !== sourceName ||
      (latestPriceEntry?.sourceUrl || null) !== sourceUrl;
    if (priceTouched) {
      await this.createPriceEntryIfChanged(tx, {
        itemId: updatedItem.id,
        purchasePackSize: updatedItem.purchasePackSize,
        purchasePackCost: this.roundMoney(updatedItem.purchasePackCost || 0),
        effectiveAt: new Date(),
        sourceName,
        sourceUrl,
        note: 'Ajuste via produto Amigas da Broa.'
      });
    }

    if (Math.abs(currentBalance - requestedBalance) >= 0.0001) {
      await tx.inventoryMovement.create({
        data: {
          itemId: updatedItem.id,
          type: 'ADJUST',
          quantity: requestedBalance,
          reason: `Ajuste de saldo do produto ${params.productName}`,
          source: 'PRODUCT_STOCK_DIRECT',
          sourceLabel: params.productName
        }
      });
    }

    return {
      inventoryItemId: updatedItem.id,
      inventoryQtyPerSaleUnit
    };
  }

  private extractMeasureLabel(value?: string | null) {
    const normalized = normalizeText(value ?? undefined);
    if (!normalized) return null;

    const measureMatch =
      normalized.match(/\b(\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|l))\b/i) ||
      normalized.match(/\(([^()]*\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|l))\)/i);
    if (!measureMatch) return null;

    const rawLabel = measureMatch[1];
    return rawLabel ? rawLabel.replace(/\s+/g, '').toLowerCase() : null;
  }

  private formatMeasureLabel(quantity: number | null | undefined, unit?: string | null) {
    const normalizedUnit = normalizeText(unit ?? undefined)?.toLowerCase() ?? null;
    if (!normalizedUnit || !MEASURE_UNITS.has(normalizedUnit)) return null;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null;

    const rounded = Math.round((quantity + Number.EPSILON) * 100) / 100;
    const formattedNumber = Number.isInteger(rounded)
      ? String(Math.trunc(rounded))
      : rounded.toLocaleString('pt-BR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        });

    return `${formattedNumber}${normalizedUnit}`;
  }

  private scoreInventoryMeasureCandidate(productName?: string | null, itemName?: string | null) {
    const productTokens = new Set(
      normalizeInventoryLookup(productName ?? '')
        .split(' ')
        .filter((token) => token.length > 1)
    );
    const itemTokens = new Set(
      normalizeInventoryLookup(itemName ?? '')
        .split(' ')
        .filter((token) => token.length > 1)
    );

    if (productTokens.size === 0 || itemTokens.size === 0) return 0;

    let intersectionCount = 0;
    for (const token of productTokens) {
      if (itemTokens.has(token)) {
        intersectionCount += 1;
      }
    }

    if (intersectionCount === 0) return 0;
    return (2 * intersectionCount) / (productTokens.size + itemTokens.size);
  }

  private normalizeSalesLimitInput(params: {
    enabled?: boolean | null;
    boxes?: number | null;
  }) {
    if (params.enabled !== true) {
      return {
        salesLimitEnabled: false,
        salesLimitBoxes: null as number | null
      };
    }

    const normalizedBoxes =
      typeof params.boxes === 'number' && Number.isInteger(params.boxes) && params.boxes > 0 ? params.boxes : null;
    if (!normalizedBoxes) {
      throw new BadRequestException('Informe um limite válido em caixas para ativar a limitação.');
    }

    return {
      salesLimitEnabled: true,
      salesLimitBoxes: normalizedBoxes
    };
  }

  private async enrichProductsWithSalesLimitState<
    T extends {
      id: number;
      salesLimitEnabled: boolean;
      salesLimitBoxes: number | null;
      salesLimitActivatedAt: Date | null;
      active: boolean;
    }
  >(
    tx: Prisma.TransactionClient | PrismaService,
    products: T[]
  ) {
    const statesByProductId = await loadProductSalesLimitStates(tx, products);
    return products.map((product) => {
      const state = statesByProductId.get(product.id);
      return {
        ...product,
        salesLimitConsumedBoxes: state?.consumedBoxes ?? null,
        salesLimitRemainingBoxes: state?.remainingBoxes ?? null,
        salesLimitExhausted: state?.exhausted ?? false
      };
    });
  }

  private async enrichProductsWithMeasureLabel<
    T extends {
      id: number;
      name: string;
      category: string | null;
      unit: string | null;
      inventoryQtyPerSaleUnit?: number | null;
      companionInventory?: {
        unit?: string | null;
      } | null;
    }
  >(tx: Prisma.TransactionClient | PrismaService, products: T[]) {
    const companionProducts = products.filter(
      (product) => isCompanionCatalogCategory(product.category ?? '')
    );

    const latestBomByProductId = new Map<
      number,
      {
        saleUnitLabel: string | null;
        items: Array<{
          qtyPerSaleUnit: number | null;
          item: {
            unit: string;
          } | null;
        }>;
      }
    >();

    if (companionProducts.length > 0) {
      const boms = await tx.bom.findMany({
        where: {
          productId: {
            in: companionProducts.map((product) => product.id)
          }
        },
        include: {
          items: {
            include: {
              item: {
                select: {
                  unit: true
                }
              }
            }
          }
        },
        orderBy: [{ productId: 'asc' }, { id: 'desc' }]
      });

      for (const bom of boms) {
        if (!latestBomByProductId.has(bom.productId)) {
          latestBomByProductId.set(bom.productId, bom);
        }
      }
    }

    const inventoryMeasureItems =
      companionProducts.length > 0
        ? await tx.inventoryItem.findMany({
            where: {
              purchasePackSize: {
                gt: 0
              }
            },
            select: {
              name: true,
              unit: true,
              purchasePackSize: true
            },
            orderBy: { id: 'asc' }
          })
        : [];

    return products.map((product) => {
      const unitMeasure = this.extractMeasureLabel(product.unit);
      if (unitMeasure) {
        return {
          ...product,
          measureLabel: unitMeasure
        };
      }

      if (!isCompanionCatalogCategory(product.category ?? '')) {
        return {
          ...product,
          measureLabel: null
        };
      }

      const directCompanionMeasure = this.formatMeasureLabel(
        product.inventoryQtyPerSaleUnit,
        product.companionInventory?.unit
      );
      if (directCompanionMeasure) {
        return {
          ...product,
          measureLabel: directCompanionMeasure
        };
      }

      const bom = latestBomByProductId.get(product.id);
      const saleUnitMeasure = this.extractMeasureLabel(bom?.saleUnitLabel);
      if (saleUnitMeasure) {
        return {
          ...product,
          measureLabel: saleUnitMeasure
        };
      }

      const uniqueMeasureCandidates = [
        ...new Set(
          (bom?.items ?? [])
            .map((entry) => this.formatMeasureLabel(entry.qtyPerSaleUnit, entry.item?.unit))
            .filter((value): value is string => Boolean(value))
        )
      ];
      if (uniqueMeasureCandidates.length === 1) {
        return {
          ...product,
          measureLabel: uniqueMeasureCandidates[0]
        };
      }

      const inventoryCandidates = inventoryMeasureItems
        .map((item) => ({
          measureLabel: this.formatMeasureLabel(item.purchasePackSize, item.unit),
          score: this.scoreInventoryMeasureCandidate(product.name, item.name)
        }))
        .filter(
          (
            candidate
          ): candidate is {
            measureLabel: string;
            score: number;
          } => Boolean(candidate.measureLabel) && candidate.score > 0
        )
        .sort((left, right) => right.score - left.score);
      const [bestInventoryCandidate, secondInventoryCandidate] = inventoryCandidates;

      return {
        ...product,
        measureLabel:
          bestInventoryCandidate &&
          bestInventoryCandidate.score >= 0.72 &&
          (secondInventoryCandidate == null || bestInventoryCandidate.score - secondInventoryCandidate.score >= 0.08)
            ? bestInventoryCandidate.measureLabel
            : null
      };
    });
  }

  private async ensureImageStorage() {
    await fs.mkdir(PRODUCT_UPLOADS_DIR, { recursive: true });
  }

  private async resolveDisplayProductImageUrl(params: {
    imageUrl?: string | null;
    productName?: string | null;
    category?: string | null;
  }) {
    const normalizedImageUrl = this.normalizeProductImageUrl(params.imageUrl);
    if (!normalizedImageUrl?.startsWith(`${PRODUCT_UPLOADS_PREFIX}/`)) {
      return normalizedImageUrl;
    }

    const canonicalCatalogImage =
      isCanonicalCatalogCategory(params.category)
        ? resolveCanonicalCatalogImageByProductName(params.productName)
        : null;

    const fileName = normalizedImageUrl.replace(`${PRODUCT_UPLOADS_PREFIX}/`, '');
    if (!isSafeManagedProductImageName(fileName)) {
      return canonicalCatalogImage ?? normalizedImageUrl;
    }

    const absolutePath = path.join(PRODUCT_UPLOADS_DIR, fileName);
    const relative = path.relative(PRODUCT_UPLOADS_DIR, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return canonicalCatalogImage ?? normalizedImageUrl;
    }

    try {
      await fs.access(absolutePath);
      return normalizedImageUrl;
    } catch {
      return canonicalCatalogImage ?? null;
    }
  }

  private normalizeCatalogProductImageForWrite(params: {
    imageUrl?: string | null;
    productName?: string | null;
    category?: string | null;
  }) {
    const normalizedImageUrl = this.normalizeProductImageUrl(params.imageUrl);
    if (!isCanonicalCatalogCategory(params.category)) {
      return normalizedImageUrl;
    }

    return resolveCanonicalCatalogImageByProductName(params.productName) ?? normalizedImageUrl;
  }

  private async resolveDisplayProductImageUrls<
    T extends {
      name: string;
      imageUrl?: string | null;
      category?: string | null;
    }
  >(products: T[]) {
    return Promise.all(
      products.map(async (product) => ({
        ...product,
        imageUrl: await this.resolveDisplayProductImageUrl({
          imageUrl: product.imageUrl,
          productName: product.name,
          category: product.category ?? null
        })
      }))
    );
  }

  private async normalizeProductImage(buffer: Buffer) {
    try {
      return await sharp(buffer, {
        failOn: 'none',
        limitInputPixels: 64 * 1000 * 1000
      })
        .rotate()
        .resize({
          width: PRODUCT_IMAGE_MAX_WIDTH,
          height: PRODUCT_IMAGE_MAX_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({
          quality: PRODUCT_IMAGE_OUTPUT_QUALITY,
          effort: 4
        })
        .toBuffer();
    } catch {
      throw new BadRequestException('Não foi possível processar a imagem enviada.');
    }
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
    product: { id: number; name: string; unit: string | null; category: string | null }
  ) {
    const existing = await tx.bom.findFirst({
      where: { productId: product.id },
      orderBy: { id: 'asc' }
    });
    if (existing) return existing;
    if (normalizeInventoryLookup(product.category ?? '') !== BROA_CATALOG_CATEGORY_KEY) {
      return null;
    }

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

  async list() {
    const products = await this.prisma.product.findMany({ orderBy: { id: 'desc' } });
    const withDisplayImageUrls = await this.resolveDisplayProductImageUrls(products);
    const withSalesLimitState = await this.enrichProductsWithSalesLimitState(this.prisma, withDisplayImageUrls);
    const withCompanionInventory = await this.enrichProductsWithCompanionInventory(
      this.prisma,
      withSalesLimitState
    );
    return this.enrichProductsWithMeasureLabel(this.prisma, withCompanionInventory);
  }

  async get(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado');
    const [withDisplayImageUrl] = await this.resolveDisplayProductImageUrls([product]);
    const [withSalesLimitState] = await this.enrichProductsWithSalesLimitState(this.prisma, [withDisplayImageUrl]);
    const [withCompanionInventory] = await this.enrichProductsWithCompanionInventory(this.prisma, [
      withSalesLimitState
    ]);
    const [enriched] = await this.enrichProductsWithMeasureLabel(this.prisma, [withCompanionInventory]);
    return enriched;
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
      throw new BadRequestException('Formato inválido. Envie jpg, png, webp ou gif.');
    }
    const receivedBytes = Math.max(file.size ?? 0, file.buffer.length);
    if (receivedBytes > PRODUCT_IMAGE_MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Arquivo excede o limite bruto de 24MB.');
    }

    await this.ensureImageStorage();
    const normalizedImageBuffer = await this.normalizeProductImage(file.buffer);
    const id = `prd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const fileName = `${id}.webp`;
    await fs.writeFile(path.join(PRODUCT_UPLOADS_DIR, fileName), normalizedImageBuffer);

    return {
      imageUrl: `${PRODUCT_UPLOADS_PREFIX}/${fileName}`
    };
  }

  create(payload: unknown) {
    const data = this.productSchemaForWrite().parse(payload);
    const {
      companionInventory,
      inventoryItemId: _ignoredInventoryItemId,
      inventoryQtyPerSaleUnit,
      ...productData
    } = data;
    const normalizedName = normalizeText(data.name) ?? data.name;
    const normalizedCategory = normalizeTitle(data.category ?? undefined);
    const requestedImageUrl = this.normalizeProductImageUrl(data.imageUrl);
    const nextImageUrl = this.normalizeCatalogProductImageForWrite({
      imageUrl: requestedImageUrl,
      productName: normalizedName,
      category: normalizedCategory ?? null
    });
    const unusedManagedImageUrl =
      requestedImageUrl &&
      requestedImageUrl !== nextImageUrl &&
      requestedImageUrl.startsWith(`${PRODUCT_UPLOADS_PREFIX}/`)
        ? requestedImageUrl
        : null;

    return this.prisma.$transaction(async (tx) => {
      const salesLimit = this.normalizeSalesLimitInput({
        enabled: data.salesLimitEnabled,
        boxes: data.salesLimitBoxes ?? null
      });
      const companionInventoryLink = await this.syncCompanionInventoryForProduct(tx, {
        productName: normalizedName,
        isCompanionProduct: isCompanionCatalogCategory(normalizedCategory ?? null),
        inventoryQtyPerSaleUnit: inventoryQtyPerSaleUnit ?? null,
        companionInventory: companionInventory ?? null
      });
      const created = await tx.product.create({
        data: {
          ...productData,
          name: normalizedName,
          category: normalizedCategory,
          unit: normalizeText(productData.unit ?? undefined)?.toLowerCase() ?? productData.unit ?? null,
          price: normalizeMoney(productData.price),
          imageUrl: nextImageUrl,
          inventoryItemId: companionInventoryLink.inventoryItemId,
          inventoryQtyPerSaleUnit: companionInventoryLink.inventoryQtyPerSaleUnit,
          drawerNote:
            isCompanionCatalogCategory(data.category ?? '')
              ? this.normalizeDrawerNote(data.drawerNote)
              : null,
          salesLimitEnabled: salesLimit.salesLimitEnabled,
          salesLimitBoxes: salesLimit.salesLimitBoxes,
          salesLimitActivatedAt: salesLimit.salesLimitEnabled ? new Date() : null
        }
      });

      if (companionInventoryLink.inventoryItemId) {
        await syncCompanionProductActiveStateByItemIds(tx, [companionInventoryLink.inventoryItemId]);
      }

      const createdAfterAvailabilitySync = await tx.product.findUnique({
        where: { id: created.id }
      });
      if (!createdAfterAvailabilitySync) {
        throw new NotFoundException('Produto não encontrado');
      }

      await this.ensureDefaultBom(tx, {
        id: createdAfterAvailabilitySync.id,
        name: createdAfterAvailabilitySync.name,
        unit: createdAfterAvailabilitySync.unit ?? null,
        category: createdAfterAvailabilitySync.category ?? null
      });

      const [withDisplayImageUrl] = await this.resolveDisplayProductImageUrls([createdAfterAvailabilitySync]);
      const [withSalesLimitState] = await this.enrichProductsWithSalesLimitState(tx, [withDisplayImageUrl]);
      const [withCompanionInventory] = await this.enrichProductsWithCompanionInventory(tx, [withSalesLimitState]);
      const [enriched] = await this.enrichProductsWithMeasureLabel(tx, [withCompanionInventory]);
      if (enriched?.salesLimitExhausted && created.active) {
        const deactivated = await tx.product.update({
          where: { id: created.id },
          data: { active: false }
        });
        const [deactivatedWithDisplayImageUrl] = await this.resolveDisplayProductImageUrls([deactivated]);
        const [deactivatedWithSalesLimitState] = await this.enrichProductsWithSalesLimitState(tx, [deactivatedWithDisplayImageUrl]);
        const [deactivatedWithCompanionInventory] = await this.enrichProductsWithCompanionInventory(tx, [
          deactivatedWithSalesLimitState
        ]);
        const [enrichedDeactivated] = await this.enrichProductsWithMeasureLabel(tx, [deactivatedWithCompanionInventory]);
        return {
          product: enrichedDeactivated,
          unusedManagedImageUrl
        };
      }

      return {
        product: enriched,
        unusedManagedImageUrl
      };
    }).then(async ({ product, unusedManagedImageUrl: disposableImageUrl }) => {
      if (disposableImageUrl) {
        await this.removeManagedProductImageIfUnused({ imageUrl: disposableImageUrl });
      }
      return product;
    });
  }

  async update(id: number, payload: unknown) {
    const current = await this.get(id);
    const data = this.productSchemaForWrite().partial().parse(payload);
    const {
      companionInventory,
      inventoryItemId: _ignoredInventoryItemId,
      inventoryQtyPerSaleUnit,
      ...productData
    } = data;
    const nextName =
      data.name !== undefined ? normalizeText(data.name ?? undefined) ?? data.name : current.name;
    const nextCategory =
      data.category !== undefined ? normalizeTitle(data.category ?? undefined) : current.category ?? null;
    const requestedImageUrl =
      data.imageUrl !== undefined ? this.normalizeProductImageUrl(data.imageUrl) : undefined;
    const nextImageUrl =
      data.imageUrl !== undefined
        ? this.normalizeCatalogProductImageForWrite({
            imageUrl: requestedImageUrl,
            productName: nextName,
            category: nextCategory
          })
        : undefined;
    const unusedManagedImageUrl =
      requestedImageUrl &&
      nextImageUrl &&
      requestedImageUrl !== nextImageUrl &&
      requestedImageUrl.startsWith(`${PRODUCT_UPLOADS_PREFIX}/`)
        ? requestedImageUrl
        : null;
    const currentSalesLimitEnabled = current.salesLimitEnabled === true;
    const currentSalesLimitBoxes =
      typeof current.salesLimitBoxes === 'number' && Number.isInteger(current.salesLimitBoxes)
        ? current.salesLimitBoxes
        : null;
    const requestedSalesLimitEnabled =
      data.salesLimitEnabled !== undefined ? data.salesLimitEnabled : currentSalesLimitEnabled;
    const requestedSalesLimitBoxes =
      data.salesLimitBoxes !== undefined ? data.salesLimitBoxes : currentSalesLimitBoxes;
    const salesLimit = this.normalizeSalesLimitInput({
      enabled: requestedSalesLimitEnabled,
      boxes: requestedSalesLimitBoxes
    });
    const shouldResetSalesLimitActivation =
      salesLimit.salesLimitEnabled !== currentSalesLimitEnabled ||
      salesLimit.salesLimitBoxes !== currentSalesLimitBoxes;

    const updated = await this.prisma.$transaction(async (tx) => {
      const companionInventoryLink = await this.syncCompanionInventoryForProduct(tx, {
        productId: id,
        productName: nextName,
        isCompanionProduct: isCompanionCatalogCategory(nextCategory),
        inventoryItemId: current.inventoryItemId ?? null,
        inventoryQtyPerSaleUnit:
          inventoryQtyPerSaleUnit !== undefined
            ? inventoryQtyPerSaleUnit
            : current.inventoryQtyPerSaleUnit ?? null,
        companionInventory:
          isCompanionCatalogCategory(nextCategory)
            ? companionInventory ?? current.companionInventory ?? null
            : null
      });

      const updated = await tx.product.update({
        where: { id },
        data: {
          ...productData,
          name: productData.name !== undefined ? nextName : undefined,
          category: productData.category !== undefined ? nextCategory : undefined,
          unit:
            productData.unit !== undefined
              ? normalizeText(productData.unit ?? undefined)?.toLowerCase() ?? null
              : undefined,
          price: productData.price !== undefined ? normalizeMoney(productData.price) : undefined,
          imageUrl: nextImageUrl,
          inventoryItemId: companionInventoryLink.inventoryItemId,
          inventoryQtyPerSaleUnit: companionInventoryLink.inventoryQtyPerSaleUnit,
          drawerNote:
            isCompanionCatalogCategory(data.category !== undefined ? data.category : current.category)
              ? data.drawerNote !== undefined
                ? this.normalizeDrawerNote(data.drawerNote)
                : current.drawerNote ?? null
              : null,
          salesLimitEnabled: salesLimit.salesLimitEnabled,
          salesLimitBoxes: salesLimit.salesLimitBoxes,
          salesLimitActivatedAt: salesLimit.salesLimitEnabled
            ? shouldResetSalesLimitActivation
              ? new Date()
              : (current.salesLimitActivatedAt ? new Date(current.salesLimitActivatedAt) : new Date())
            : null
        }
      });

      if (companionInventoryLink.inventoryItemId) {
        await syncCompanionProductActiveStateByItemIds(tx, [companionInventoryLink.inventoryItemId]);
      }

      const updatedAfterAvailabilitySync = await tx.product.findUnique({
        where: { id: updated.id }
      });
      if (!updatedAfterAvailabilitySync) {
        throw new NotFoundException('Produto não encontrado');
      }

      return updatedAfterAvailabilitySync;
    });

    if (nextImageUrl !== undefined && nextImageUrl !== current.imageUrl) {
      await this.removeManagedProductImageIfUnused({
        imageUrl: current.imageUrl,
        ignoredProductId: id
      });
    }
    if (unusedManagedImageUrl) {
      await this.removeManagedProductImageIfUnused({ imageUrl: unusedManagedImageUrl });
    }

    const [withDisplayImageUrl] = await this.resolveDisplayProductImageUrls([updated]);
    const [withSalesLimitState] = await this.enrichProductsWithSalesLimitState(this.prisma, [withDisplayImageUrl]);
    const [withCompanionInventory] = await this.enrichProductsWithCompanionInventory(this.prisma, [
      withSalesLimitState
    ]);
    const [enriched] = await this.enrichProductsWithMeasureLabel(this.prisma, [withCompanionInventory]);
    if (enriched?.salesLimitExhausted && updated.active) {
      const deactivated = await this.prisma.product.update({
        where: { id },
        data: { active: false }
      });
      const [deactivatedWithDisplayImageUrl] = await this.resolveDisplayProductImageUrls([deactivated]);
      const [deactivatedWithSalesLimitState] = await this.enrichProductsWithSalesLimitState(this.prisma, [deactivatedWithDisplayImageUrl]);
      const [deactivatedWithCompanionInventory] = await this.enrichProductsWithCompanionInventory(
        this.prisma,
        [deactivatedWithSalesLimitState]
      );
      const [enrichedDeactivated] = await this.enrichProductsWithMeasureLabel(this.prisma, [deactivatedWithCompanionInventory]);
      return enrichedDeactivated;
    }

    return enriched;
  }

  async remove(id: number) {
    const product = await this.get(id);
    const [itemsCount, bomsCount] = await this.prisma.$transaction([
      this.prisma.orderItem.count({ where: { productId: id } }),
      this.prisma.bom.count({ where: { productId: id } })
    ]);
    const inventoryMovementsCount = product.inventoryItemId
      ? await this.prisma.inventoryMovement.count({ where: { itemId: product.inventoryItemId } })
      : 0;

    if (itemsCount > 0 || bomsCount > 0 || inventoryMovementsCount > 0) {
      await this.prisma.product.update({
        where: { id },
        data: { active: false }
      });
      return { archived: true };
    }

    await this.prisma.product.delete({ where: { id } });
    if (product.inventoryItemId) {
      await this.prisma.inventoryItem.delete({ where: { id: product.inventoryItemId } }).catch(() => null);
    }
    await this.removeManagedProductImageIfUnused({ imageUrl: product.imageUrl });
    return { deleted: true };
  }
}

export { PRODUCT_UPLOADS_DIR };
