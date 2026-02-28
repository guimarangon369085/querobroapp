import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
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
}
