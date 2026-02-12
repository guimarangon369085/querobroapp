import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';

@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService]
})
export class ReceiptsModule {}
