import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { StockModule } from './modules/stock/stock.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { BomModule } from './modules/bom/bom.module.js';

@Module({
  imports: [
    PrismaModule,
    ProductsModule,
    CustomersModule,
    OrdersModule,
    PaymentsModule,
    StockModule,
    InventoryModule,
    BomModule
  ],
  controllers: [AppController]
})
export class AppModule {}
