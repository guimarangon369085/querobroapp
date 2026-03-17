import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { DashboardService } from './dashboard.service.js';

const daysSchema = z.coerce.number().int().min(1).max(365).default(30);

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly service: DashboardService) {}

  @Get('summary')
  summary(@Query('days') days?: string) {
    const rangeDays = parseWithSchema(daysSchema, days ?? 30);
    return this.service.getSummary(rangeDays);
  }
}
