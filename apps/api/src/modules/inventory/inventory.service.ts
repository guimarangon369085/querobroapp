import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { InventoryItemSchema, InventoryMovementSchema, StockMovementTypeEnum } from '@querobroapp/shared';

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listItems() {
    return this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } });
  }

  createItem(payload: unknown) {
    const data = InventoryItemSchema.omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.inventoryItem.create({ data });
  }

  updateItem(id: number, payload: unknown) {
    const data = InventoryItemSchema.partial().omit({ id: true, createdAt: true }).parse(payload);
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

  createMovement(payload: unknown) {
    const data = InventoryMovementSchema.omit({ id: true, createdAt: true }).parse(payload);
    StockMovementTypeEnum.parse(data.type);
    return this.prisma.inventoryMovement.create({ data });
  }

  async removeMovement(id: number) {
    const movement = await this.prisma.inventoryMovement.findUnique({ where: { id } });
    if (!movement) throw new NotFoundException('Movimentacao nao encontrada');
    await this.prisma.inventoryMovement.delete({ where: { id } });
  }
}
