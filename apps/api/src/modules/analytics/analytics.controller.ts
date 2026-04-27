import { Body, Controller, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { Public } from '../../security/public.decorator.js';
import { getSecurityRuntimeConfig } from '../../security/security-config.js';
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

function extractBearerToken(authHeader?: string | null) {
  const value = String(authHeader || '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}

  private assertAnalyticsAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken =
      String(process.env.ANALYTICS_BRIDGE_TOKEN || '').trim() ||
      String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge de analytics inválido.');
    }

    if ((process.env.NODE_ENV || 'development') === 'production' || getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException(
        'ANALYTICS_BRIDGE_TOKEN ou ORDER_FORM_BRIDGE_TOKEN obrigatorio para expor analytics.'
      );
    }
  }

  @Public()
  @Post('events')
  ingest(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-analytics-token') analyticsToken?: string
  ) {
    this.assertAnalyticsAccess(authorization, analyticsToken);
    return this.service.ingest(parseWithSchema(analyticsTrackRequestSchema, body));
  }
}
