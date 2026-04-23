import { Body, Controller, Get, Headers, Inject, Param, Post, Put, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { DeliveriesService } from './deliveries.service.js';
import { Public } from '../../security/public.decorator.js';
import { getSecurityRuntimeConfig } from '../../security/security-config.js';

const idSchema = z.coerce.number().int().positive();

function extractBearerToken(authHeader?: string | null) {
  const value = String(authHeader || '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Controller('deliveries')
export class DeliveriesController {
  constructor(@Inject(DeliveriesService) private readonly service: DeliveriesService) {}

  private assertPublicQuoteAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge de frete inválido.');
    }

    if (getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException(
        'ORDER_FORM_BRIDGE_TOKEN obrigatório para expor a cotação pública de frete com auth ligada.'
      );
    }
  }

  @Public()
  @Post('quotes')
  quote(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-order-form-token') formToken?: string
  ) {
    this.assertPublicQuoteAccess(authorization, formToken);
    return this.service.quoteDelivery(body);
  }

  @Post('quotes/internal')
  quoteInternal(@Body() body: unknown) {
    return this.service.quoteDelivery(body, {
      enforceExternalSchedule: false,
      allowManualFallback: false
    });
  }

  @Get('pricing-config')
  getPricingConfig() {
    return this.service.getPricingConfig();
  }

  @Put('pricing-config')
  updatePricingConfig(@Body() body: unknown) {
    return this.service.updatePricingConfig(body);
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
