import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryProductsService } from './inventory-products.service.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryProductsService],
  exports: [InventoryService, InventoryProductsService]
})
export class InventoryModule {}
