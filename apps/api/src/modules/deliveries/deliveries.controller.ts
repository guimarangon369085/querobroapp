import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { Public } from '../../security/public.decorator.js';
import { DeliveriesService } from './deliveries.service.js';

const idSchema = z.coerce.number().int().positive();

@Controller('deliveries')
export class DeliveriesController {
  constructor(@Inject(DeliveriesService) private readonly service: DeliveriesService) {}

  @Get('orders/:id/uber-direct/readiness')
  getUberDirectReadiness(@Param('id') id: string) {
    return this.service.getUberDirectReadiness(parseWithSchema(idSchema, id));
  }

  @Post('orders/:id/uber-direct/quote')
  getUberDirectQuote(@Param('id') id: string) {
    return this.service.getUberDirectQuote(parseWithSchema(idSchema, id));
  }

  @Post('orders/:id/uber-direct/dispatch')
  dispatchOrderToUber(@Param('id') id: string) {
    return this.service.dispatchOrderToUber(parseWithSchema(idSchema, id));
  }

  @Get('orders/:id/tracking')
  getOrderTracking(@Param('id') id: string) {
    return this.service.getOrderTracking(parseWithSchema(idSchema, id));
  }

  @Post('orders/:id/tracking/complete')
  markTrackingAsDelivered(@Param('id') id: string) {
    return this.service.markTrackingAsDelivered(parseWithSchema(idSchema, id));
  }

  @Post('uber-direct/webhook')
  @Public()
  handleUberDirectWebhook(@Body() body: unknown) {
    return this.service.handleUberDirectWebhook(body);
  }
}
