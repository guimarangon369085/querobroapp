import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../security/roles.decorator.js';
import { AutomationsService } from './automations.service.js';

@Controller('automations')
@Roles('admin', 'operator')
export class AutomationsController {
  constructor(@Inject(AutomationsService) private readonly service: AutomationsService) {}

  @Get('runs')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listRuns(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Headers('x-automations-token') automationsToken?: string,
    @Headers('x-receipts-token') receiptsToken?: string
  ) {
    return this.service.listRuns({ limit, status }, automationsToken || receiptsToken);
  }

  @Get('runs/:id')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  getRun(
    @Param('id') id: string,
    @Headers('x-automations-token') automationsToken?: string,
    @Headers('x-receipts-token') receiptsToken?: string
  ) {
    return this.service.getRun(id, automationsToken || receiptsToken);
  }

  @Post('runs')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  createRun(
    @Body() body: unknown,
    @Headers('x-automations-token') automationsToken?: string,
    @Headers('x-receipts-token') receiptsToken?: string
  ) {
    return this.service.createRun(body, automationsToken || receiptsToken);
  }

  @Post('runs/:id/start')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  startRun(
    @Param('id') id: string,
    @Headers('x-automations-token') automationsToken?: string,
    @Headers('x-receipts-token') receiptsToken?: string
  ) {
    return this.service.startRun(id, automationsToken || receiptsToken);
  }
}
