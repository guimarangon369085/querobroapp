import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { Public } from '../../security/public.decorator.js';
import { WhatsAppService } from './whatsapp.service.js';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(@Inject(WhatsAppService) private readonly service: WhatsAppService) {}

  @Public()
  @Get('webhook')
  async verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string
  ) {
    return this.service.verifyWebhookSubscription(mode, verifyToken, challenge);
  }

  @Public()
  @Post('webhook')
  ingestWebhook(@Body() body: unknown) {
    return this.service.handleWebhookEvent(body);
  }
}
