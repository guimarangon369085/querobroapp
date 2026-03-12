import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service.js';

@Module({
  providers: [WhatsAppService],
  exports: [WhatsAppService]
})
export class WhatsAppModule {}
