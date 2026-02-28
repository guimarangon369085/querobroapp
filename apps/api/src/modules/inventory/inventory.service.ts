import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { InventoryCategoryEnum, StockMovementTypeEnum } from '@querobroapp/shared';
import { parseLocaleNumber } from '../../common/normalize.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const nonNegativeNumberInputSchema = z.preprocess((value) => {
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative());

const optionalNonNegativeNumberInputSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative().optional());

const optionalNullableNonNegativeNumberInputSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative().nullable().optional());

const inventoryItemCreateSchema = z.object({
  name: z.string().trim().min(1),
  category: InventoryCategoryEnum,
  unit: z.string().trim().min(1),
  purchasePackSize: nonNegativeNumberInputSchema,
  purchasePackCost: optionalNonNegativeNumberInputSchema
});

const inventoryItemUpdateSchema = inventoryItemCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualizar.'
  });

const inventoryMovementCreateSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  orderId: z.coerce.number().int().positive().optional().nullable(),
  type: StockMovementTypeEnum,
  quantity: nonNegativeNumberInputSchema,
  reason: z.string().trim().optional().nullable(),
  source: z.string().trim().min(1).max(40).optional().nullable(),
  sourceLabel: z.string().trim().min(1).max(140).optional().nullable(),
  unitCost: optionalNullableNonNegativeNumberInputSchema
});

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listItems() {
    return this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } });
  }

  createItem(payload: unknown) {
    const data = parseWithSchema(inventoryItemCreateSchema, payload);
    return this.prisma.inventoryItem.create({ data });
  }

  async updateItem(id: number, payload: unknown) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    const data = parseWithSchema(inventoryItemUpdateSchema, payload);
    return this.prisma.inventoryItem.update({ where: { id }, data });
  }

  async removeItem(id: number) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    const [movementsCount, bomItemsCount] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where: { itemId: id } }),
      this.prisma.bomItem.count({ where: { itemId: id } })
    ]);

    if (movementsCount > 0 || bomItemsCount > 0) {
      throw new ConflictException('Item possui movimentos ou ficha tecnica vinculada.');
    }

    await this.prisma.inventoryItem.delete({ where: { id } });
  }

  listMovements() {
    return this.prisma.inventoryMovement.findMany({
      include: { item: true },
      orderBy: { id: 'desc' }
    });
  }

  async createMovement(payload: unknown) {
    const data = parseWithSchema(inventoryMovementCreateSchema, payload);

    const item = await this.prisma.inventoryItem.findUnique({ where: { id: data.itemId } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    if (data.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
    }

    return this.prisma.inventoryMovement.create({ data });
  }

  async removeMovement(id: number) {
    const movement = await this.prisma.inventoryMovement.findUnique({ where: { id } });
    if (!movement) throw new NotFoundException('Movimentacao nao encontrada');
    await this.prisma.inventoryMovement.delete({ where: { id } });
  }

  async clearAllMovements() {
    const [inventoryResult, stockResult] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.deleteMany({}),
      this.prisma.stockMovement.deleteMany({})
    ]);

    return {
      inventoryMovementsDeleted: inventoryResult.count,
      stockMovementsDeleted: stockResult.count,
      totalDeleted: inventoryResult.count + stockResult.count
    };
  }
}
