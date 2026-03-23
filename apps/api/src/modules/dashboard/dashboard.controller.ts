import { Controller, Get, Headers, Inject, Query, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { Public } from '../../security/public.decorator.js';
import { getSecurityRuntimeConfig } from '../../security/security-config.js';
import { DashboardService } from './dashboard.service.js';

const daysSchema = z.coerce.number().int().min(1).max(365).default(30);

function extractBearerToken(authHeader?: string | null) {
  const value = String(authHeader || '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly service: DashboardService) {}

  private assertDashboardAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken =
      String(process.env.DASHBOARD_BRIDGE_TOKEN || '').trim() ||
      String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge de dashboard invalido.');
    }

    if ((process.env.NODE_ENV || 'development') === 'production' || getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException(
        'DASHBOARD_BRIDGE_TOKEN ou ORDER_FORM_BRIDGE_TOKEN obrigatorio para expor o dashboard.'
      );
    }
  }

  @Public()
  @Get('summary')
  summary(
    @Query('days') days?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-dashboard-token') dashboardToken?: string
  ) {
    this.assertDashboardAccess(authorization, dashboardToken);
    const rangeDays = parseWithSchema(daysSchema, days ?? 30);
    return this.service.getSummary(rangeDays);
  }
}
