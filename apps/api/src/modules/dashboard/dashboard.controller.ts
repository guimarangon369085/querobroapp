import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../security/public.decorator.js';
import { getSecurityRuntimeConfig } from '../../security/security-config.js';
import { parseWithSchema } from '../../common/validation.js';
import { DashboardService } from './dashboard.service.js';

const idSchema = z.coerce.number().int().positive();

function extractBearerToken(authHeader?: string | null) {
  const value = String(authHeader || '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly service: DashboardService) {}

  private assertCouponResolveAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken =
      String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim() ||
      String(process.env.DASHBOARD_BRIDGE_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge de cupom invalido.');
    }

    if ((process.env.NODE_ENV || 'development') !== 'production' && !getSecurityRuntimeConfig().enabled) {
      return;
    }

    throw new UnauthorizedException(
      'ORDER_FORM_BRIDGE_TOKEN ou DASHBOARD_BRIDGE_TOKEN obrigatorio para expor a validacao publica de cupons.'
    );
  }

  @Get('summary')
  summary(@Query('days') days?: string) {
    return this.service.getSummary({ days });
  }

  @Get('coupons')
  listCoupons() {
    return this.service.listCoupons();
  }

  @Post('coupons')
  createCoupon(@Body() body: unknown) {
    return this.service.createCoupon(body);
  }

  @Put('coupons/:id')
  updateCoupon(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateCoupon(parseWithSchema(idSchema, id), body);
  }

  @Delete('coupons/:id')
  async removeCoupon(@Param('id') id: string) {
    await this.service.removeCoupon(parseWithSchema(idSchema, id));
    return { ok: true };
  }

  @Public()
  @Post('coupons/resolve')
  resolveCoupon(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-order-form-token') formToken?: string
  ) {
    this.assertCouponResolveAccess(authorization, formToken);
    return this.service.resolveCoupon(body);
  }
}
