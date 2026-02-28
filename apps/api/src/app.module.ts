import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { DeliveriesModule } from './modules/deliveries/deliveries.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { StockModule } from './modules/stock/stock.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { BomModule } from './modules/bom/bom.module.js';
import { ProductionModule } from './modules/production/production.module.js';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module.js';
import { ReceiptsModule } from './modules/receipts/receipts.module.js';
import { RuntimeConfigModule } from './modules/runtime-config/runtime-config.module.js';
import { AutomationsModule } from './modules/automations/automations.module.js';
import { VoiceModule } from './modules/voice/voice.module.js';
import { AlexaModule } from './modules/alexa/alexa.module.js';
import { AuthGuard } from './security/auth.guard.js';
import { RbacGuard } from './security/rbac.guard.js';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 120
        }
      ]
    }),
    PrismaModule,
    ProductsModule,
    CustomersModule,
    OrdersModule,
    DeliveriesModule,
    PaymentsModule,
    StockModule,
    InventoryModule,
    BomModule,
    ProductionModule,
    WhatsappModule,
    ReceiptsModule,
    RuntimeConfigModule,
    AutomationsModule,
    VoiceModule,
    AlexaModule
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    },
    {
      provide: APP_GUARD,
      useClass: RbacGuard
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
