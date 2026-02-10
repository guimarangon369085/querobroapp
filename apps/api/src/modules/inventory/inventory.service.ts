import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { InventoryItemSchema, InventoryMovementSchema, StockMovementTypeEnum } from '@querobroapp/shared';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

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
}
