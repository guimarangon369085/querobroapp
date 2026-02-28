import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { Public } from '../../security/public.decorator.js';
import { WhatsappService } from './whatsapp.service.js';

@Controller('whatsapp')
export class WhatsappController {
  constructor(@Inject(WhatsappService) private readonly service: WhatsappService) {}

  @Get('outbox')
  list(@Query('status') status?: string) {
    return this.service.listOutbox(status);
  }

  @Post('flows/order-intake/launch')
  launchOrderIntakeFlow(@Body() body: unknown) {
    return this.service.launchOrderIntakeFlow(body);
  }

  @Public()
  @Get('flows/order-intake/sessions/:sessionId')
  getOrderIntakeSession(@Param('sessionId') sessionId: string, @Query('token') token?: string) {
    return this.service.getOrderIntakeSession(sessionId, token);
  }

  @Public()
  @Post('flows/order-intake/submit')
  submitOrderIntakeFlow(@Body() body: unknown) {
    return this.service.submitOrderIntakeFlow(body);
  }
}
