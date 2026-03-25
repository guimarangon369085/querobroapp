import { Body, Controller, Get, Param, Post, Delete, Headers, Inject, UnauthorizedException } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';
import { Public } from '../../security/public.decorator.js';
import { getSecurityRuntimeConfig } from '../../security/security-config.js';

const idSchema = z.coerce.number().int().positive();

function extractBearerToken(authHeader?: string | null) {
  const value = String(authHeader || '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly service: PaymentsService) {}

  private assertPixSettlementWebhookAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken = String(process.env.BANK_SYNC_WEBHOOK_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge bancario invalido.');
    }

    if ((process.env.NODE_ENV || 'development') === 'production' || getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException('BANK_SYNC_WEBHOOK_TOKEN obrigatorio para expor a liquidacao PIX.');
    }
  }

  private assertOpenFinanceWebhookAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken = String(
      process.env.OPEN_FINANCE_WEBHOOK_TOKEN || process.env.BANK_SYNC_WEBHOOK_TOKEN || ''
    ).trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do webhook Open Finance invalido.');
    }

    if ((process.env.NODE_ENV || 'development') === 'production' || getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException(
        'OPEN_FINANCE_WEBHOOK_TOKEN ou BANK_SYNC_WEBHOOK_TOKEN obrigatorio para expor o webhook Open Finance.'
      );
    }
  }

  private assertPluggyWebhookAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken = String(
      process.env.PLUGGY_WEBHOOK_TOKEN || process.env.OPEN_FINANCE_WEBHOOK_TOKEN || process.env.BANK_SYNC_WEBHOOK_TOKEN || ''
    ).trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do webhook Pluggy invalido.');
    }

    if ((process.env.NODE_ENV || 'development') === 'production' || getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException(
        'PLUGGY_WEBHOOK_TOKEN, OPEN_FINANCE_WEBHOOK_TOKEN ou BANK_SYNC_WEBHOOK_TOKEN obrigatorio para expor o webhook Pluggy.'
      );
    }
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.service.create(body);
  }

  @Get(':id/pix-charge')
  pixCharge(@Param('id') id: string) {
    return this.service.getPaymentPixCharge(parseWithSchema(idSchema, id));
  }

  @Public()
  @Post('pix-settlements/webhook')
  settlePixWebhook(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-bank-sync-token') bankSyncToken?: string
  ) {
    this.assertPixSettlementWebhookAccess(authorization, bankSyncToken);
    return this.service.settlePixWebhook(body);
  }

  @Public()
  @Post('pix-reconciliations/webhook')
  reconcilePixWebhook(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-bank-sync-token') bankSyncToken?: string
  ) {
    this.assertPixSettlementWebhookAccess(authorization, bankSyncToken);
    return this.service.reconcilePixWebhook(body);
  }

  @Public()
  @Post('open-finance/webhook')
  openFinanceWebhook(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-open-finance-token') openFinanceToken?: string,
    @Headers('x-bank-sync-token') bankSyncToken?: string
  ) {
    this.assertOpenFinanceWebhookAccess(authorization, openFinanceToken || bankSyncToken);
    return this.service.ingestOpenFinancePixWebhook(body);
  }

  @Public()
  @Post('pluggy/webhook')
  pluggyWebhook(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-pluggy-token') pluggyToken?: string,
    @Headers('x-open-finance-token') openFinanceToken?: string,
    @Headers('x-bank-sync-token') bankSyncToken?: string
  ) {
    this.assertPluggyWebhookAccess(authorization, pluggyToken || openFinanceToken || bankSyncToken);
    return this.service.ingestPluggyWebhook(body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseWithSchema(idSchema, id));
    return { ok: true };
  }
}
