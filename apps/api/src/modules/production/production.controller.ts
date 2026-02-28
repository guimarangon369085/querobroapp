import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { ProductionService } from './production.service.js';

const batchIdSchema = z.string().trim().min(1).max(160);

@Controller('production')
export class ProductionController {
  constructor(@Inject(ProductionService) private readonly service: ProductionService) {}

  @Get('requirements')
  requirements(@Query('date') date?: string) {
    return this.service.requirements(date);
  }

  @Get('queue')
  queue() {
    return this.service.queue();
  }

  @Post('batches/start-next')
  startNextBatch(@Body() body?: { triggerSource?: string; triggerLabel?: string; requestedTimerMinutes?: number }) {
    return this.service.startNextBatch(body || {});
  }

  @Post('batches/:id/complete')
  completeBatch(@Param('id') id: string) {
    return this.service.completeBatch(parseWithSchema(batchIdSchema, id));
  }

  @Post('rebalance-legacy-consumption')
  rebalanceLegacyConsumption() {
    return this.service.rebalanceLegacyOrderConsumption();
  }
}
