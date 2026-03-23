import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module.js';
import { ProductionController } from './production.controller.js';
import { ProductionService } from './production.service.js';

@Module({
  imports: [DeliveriesModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService]
})
export class ProductionModule {}
