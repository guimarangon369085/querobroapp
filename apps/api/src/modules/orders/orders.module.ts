import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { DeliveriesModule } from '../deliveries/deliveries.module.js';

@Module({
  imports: [PaymentsModule, WhatsAppModule, DeliveriesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderNotificationsService],
  exports: [OrdersService]
})
export class OrdersModule {}
