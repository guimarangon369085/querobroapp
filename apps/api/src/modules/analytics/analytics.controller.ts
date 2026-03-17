import { Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { Public } from '../../security/public.decorator.js';
import { AnalyticsService } from './analytics.service.js';

const analyticsEventInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(160),
  eventType: z.enum(['PAGE_VIEW', 'LINK_CLICK', 'WEB_VITAL', 'FUNNEL', 'APP_ERROR']),
  path: z.string().trim().max(1024).optional().nullable(),
  href: z.string().trim().max(2048).optional().nullable(),
  label: z.string().trim().max(240).optional().nullable(),
  referrerHost: z.string().trim().max(240).optional().nullable(),
  referrerUrl: z.string().trim().max(2048).optional().nullable(),
  source: z.string().trim().max(240).optional().nullable(),
  medium: z.string().trim().max(240).optional().nullable(),
  campaign: z.string().trim().max(240).optional().nullable(),
  deviceType: z.string().trim().max(80).optional().nullable(),
  browser: z.string().trim().max(120).optional().nullable(),
  os: z.string().trim().max(120).optional().nullable(),
  locale: z.string().trim().max(80).optional().nullable(),
  timezone: z.string().trim().max(120).optional().nullable(),
  viewportWidth: z.number().int().min(0).max(20_000).optional().nullable(),
  viewportHeight: z.number().int().min(0).max(20_000).optional().nullable(),
  screenWidth: z.number().int().min(0).max(20_000).optional().nullable(),
  screenHeight: z.number().int().min(0).max(20_000).optional().nullable(),
  metricName: z.string().trim().max(80).optional().nullable(),
  metricValue: z.number().finite().optional().nullable(),
  metricUnit: z.string().trim().max(40).optional().nullable(),
  navigationType: z.string().trim().max(80).optional().nullable(),
  meta: z.unknown().optional()
});

const analyticsTrackRequestSchema = z.object({
  events: z.array(analyticsEventInputSchema).min(1).max(50)
});

@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}

  @Public()
  @Post('events')
  ingest(@Body() body: unknown) {
    return this.service.ingest(parseWithSchema(analyticsTrackRequestSchema, body));
  }
}
