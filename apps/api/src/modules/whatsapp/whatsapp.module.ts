import { Module, forwardRef } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({
  imports: [forwardRef(() => OrdersModule)],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService]
})
export class WhatsAppModule {}
