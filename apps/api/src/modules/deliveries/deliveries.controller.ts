import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { DeliveriesService } from './deliveries.service.js';

const idSchema = z.coerce.number().int().positive();

@Controller('deliveries')
export class DeliveriesController {
  constructor(@Inject(DeliveriesService) private readonly service: DeliveriesService) {}

  @Post('quotes')
  quote(@Body() body: unknown) {
    return this.service.quoteDelivery(body);
  }

  @Post('quotes/internal')
  quoteInternal(@Body() body: unknown) {
    return this.service.quoteDelivery(body, {
      enforceExternalSchedule: false,
      allowManualFallback: false
    });
  }

  @Get('orders/:id/readiness')
  getReadiness(@Param('id') id: string) {
    return this.service.getReadiness(parseWithSchema(idSchema, id));
  }

  @Post('orders/:id/quote')
  refreshOrderQuote(@Param('id') id: string) {
    return this.service.refreshOrderQuote(parseWithSchema(idSchema, id));
  }

  @Post('orders/:id/start')
  startOrderDelivery(@Param('id') id: string) {
    return this.service.startOrderDelivery(parseWithSchema(idSchema, id));
  }

  @Get('orders/:id/tracking')
  getOrderTracking(@Param('id') id: string) {
    return this.service.getOrderTracking(parseWithSchema(idSchema, id));
  }

  @Post('orders/:id/tracking/complete')
  markTrackingAsDelivered(@Param('id') id: string) {
    return this.service.markTrackingAsDelivered(parseWithSchema(idSchema, id));
  }
}
