import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module.js';

@Module({
  imports: [RuntimeConfigModule, InventoryModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService]
})
export class ReceiptsModule {}
