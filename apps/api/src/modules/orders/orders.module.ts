import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { DeliveriesModule } from '../deliveries/deliveries.module.js';

@Module({
  imports: [PaymentsModule, DeliveriesModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderNotificationsService,
    {
      provide: 'ORDERS_SERVICE',
      useExisting: OrdersService
    }
  ],
  exports: [OrdersService, 'ORDERS_SERVICE']
})
export class OrdersModule {}
