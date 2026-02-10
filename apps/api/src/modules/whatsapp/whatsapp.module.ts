import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller.js';
import { WhatsappService } from './whatsapp.service.js';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
