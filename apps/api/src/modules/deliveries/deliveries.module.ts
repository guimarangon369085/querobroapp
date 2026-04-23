import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller.js';
import { DeliveriesService } from './deliveries.service.js';
import { DeliveryPricingConfigService } from './delivery-pricing-config.service.js';

@Module({
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveryPricingConfigService],
  exports: [DeliveriesService]
})
export class DeliveriesModule {}
