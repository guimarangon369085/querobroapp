import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { parseLocaleNumber } from '../../common/normalize.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const nullableNonNegativeNumberInputSchema = z.preprocess((value) => {
  if (value == null || value === '') return null;
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative().nullable());

const bomItemInputSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  qtyPerRecipe: nullableNonNegativeNumberInputSchema.optional(),
  qtyPerSaleUnit: nullableNonNegativeNumberInputSchema.optional(),
  qtyPerUnit: nullableNonNegativeNumberInputSchema.optional()
});

const optionalNullableLabelSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}, z.string().min(1).nullable().optional());

const bomPayloadSchema = z.object({
  productId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  saleUnitLabel: optionalNullableLabelSchema,
  yieldUnits: nullableNonNegativeNumberInputSchema.optional(),
  items: z.array(bomItemInputSchema).optional().default([])
});

@Injectable()
export class BomService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.bom.findMany({
      include: { items: { include: { item: true } }, product: true },
      orderBy: { id: 'asc' }
    });
  }

  async get(id: number) {
    const bom = await this.prisma.bom.findUnique({
      where: { id },
      include: { items: { include: { item: true } }, product: true }
    });
    if (!bom) throw new NotFoundException('BOM nao encontrado');
    return bom;
  }

  async create(payload: unknown) {
    const data = parseWithSchema(bomPayloadSchema, payload);
    const items = data.items ?? [];

    return this.prisma.bom.create({
      data: {
        productId: data.productId,
        name: data.name,
        saleUnitLabel: data.saleUnitLabel ?? null,
        yieldUnits: data.yieldUnits ?? null,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            qtyPerRecipe: item.qtyPerRecipe ?? null,
            qtyPerSaleUnit: item.qtyPerSaleUnit ?? null,
            qtyPerUnit: item.qtyPerUnit ?? null
          }))
        }
      },
      include: { items: true, product: true }
    });
  }

  async update(id: number, payload: unknown) {
    const data = parseWithSchema(bomPayloadSchema, payload);
    const items = data.items ?? [];

    return this.prisma.$transaction(async (tx) => {
      await tx.bom.update({
        where: { id },
        data: {
          productId: data.productId,
          name: data.name,
          saleUnitLabel: data.saleUnitLabel ?? null,
          yieldUnits: data.yieldUnits ?? null
        }
      });

      await tx.bomItem.deleteMany({ where: { bomId: id } });
      if (items.length > 0) {
        await tx.bomItem.createMany({
          data: items.map((item) => ({
            bomId: id,
            itemId: item.itemId,
            qtyPerRecipe: item.qtyPerRecipe ?? null,
            qtyPerSaleUnit: item.qtyPerSaleUnit ?? null,
            qtyPerUnit: item.qtyPerUnit ?? null
          }))
        });
      }

      return tx.bom.findUnique({
        where: { id },
        include: { items: { include: { item: true } }, product: true }
      });
    });
  }

  async remove(id: number) {
    await this.get(id);
    await this.prisma.bom.delete({ where: { id } });
  }
}
