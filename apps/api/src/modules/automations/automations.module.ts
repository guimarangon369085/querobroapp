import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller.js';
import { AutomationsService } from './automations.service.js';
import { ProductionModule } from '../production/production.module.js';
import { ReceiptsModule } from '../receipts/receipts.module.js';

@Module({
  imports: [ProductionModule, ReceiptsModule],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService]
})
export class AutomationsModule {}
