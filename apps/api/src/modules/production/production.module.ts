import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller.js';
import { ProductionService } from './production.service.js';

@Module({
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class ProductionModule {}
