import { Controller, Get, Inject, Query } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service.js';

@Controller('whatsapp/outbox')
export class WhatsappController {
  constructor(@Inject(WhatsappService) private readonly service: WhatsappService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.listOutbox(status);
  }
}
