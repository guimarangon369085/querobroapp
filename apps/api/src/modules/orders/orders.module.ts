import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';

@Module({
  imports: [PaymentsModule, WhatsAppModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService]
})
export class OrdersModule {}
