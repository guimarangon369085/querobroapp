import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { ProductionService } from './production.service.js';

const batchIdSchema = z.string().trim().min(1).max(160);
const startNextBatchPayloadSchema = z.object({
  triggerSource: z.string().trim().min(1).max(40).optional(),
  triggerLabel: z.string().trim().min(1).max(160).optional(),
  requestedTimerMinutes: z.number().finite().positive().max(24 * 60).optional()
});

@Controller('production')
export class ProductionController {
  constructor(@Inject(ProductionService) private readonly service: ProductionService) {}

  @Get('requirements')
  requirements(@Query('date') date?: string) {
    return this.service.requirements(date);
  }

  @Get('stock-planning')
  stockPlanning() {
    return this.service.stockPlanning();
  }

  @Get('queue')
  queue() {
    return this.service.queue();
  }

  @Post('batches/start-next')
  startNextBatch(@Body() body: unknown) {
    return this.service.startNextBatch(parseWithSchema(startNextBatchPayloadSchema, body ?? {}));
  }

  @Post('batches/:id/complete')
  completeBatch(@Param('id') id: string) {
    return this.service.completeBatch(parseWithSchema(batchIdSchema, id));
  }
}
