import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';
import { BuilderModule } from '../builder/builder.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';

@Module({
  imports: [BuilderModule, InventoryModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService]
})
export class ReceiptsModule {}
