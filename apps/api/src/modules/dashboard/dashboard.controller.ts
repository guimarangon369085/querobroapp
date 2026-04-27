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
  UploadedFile,
  UseInterceptors,
  UnauthorizedException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Public } from '../../security/public.decorator.js';
import { getSecurityRuntimeConfig } from '../../security/security-config.js';
import { parseWithSchema } from '../../common/validation.js';
import { DashboardService } from './dashboard.service.js';
import { BankStatementsService, STATEMENT_UPLOAD_MAX_BYTES } from './bank-statements.service.js';

const idSchema = z.coerce.number().int().positive();
const statementCategorySchema = z.enum([
  'SALES',
  'UNMATCHED_INFLOW',
  'MARKETPLACE_REFUND',
  'INGREDIENTS',
  'DELIVERY',
  'PACKAGING',
  'SOFTWARE',
  'MARKETPLACE',
  'OWNER',
  'OTHER_EXPENSE',
  'OTHER_INFLOW',
]);
const statementTransactionUpdateSchema = z.object({
  classificationCode: z.string().trim().min(1).max(60).optional().nullable(),
  matchedPaymentId: z.coerce.number().int().positive().optional().nullable(),
  matchedOrderId: z.coerce.number().int().positive().optional().nullable(),
});
const statementClassificationOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  baseCategory: statementCategorySchema,
  active: z.boolean().optional(),
});

function extractBearerToken(authHeader?: string | null) {
  const value = String(authHeader || '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DashboardService) private readonly service: DashboardService,
    @Inject(BankStatementsService) private readonly bankStatementsService: BankStatementsService
  ) {}

  private assertCouponResolveAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken =
      String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim() ||
      String(process.env.DASHBOARD_BRIDGE_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge de cupom inválido.');
    }

    if ((process.env.NODE_ENV || 'development') !== 'production' && !getSecurityRuntimeConfig().enabled) {
      return;
    }

    throw new UnauthorizedException(
      'ORDER_FORM_BRIDGE_TOKEN ou DASHBOARD_BRIDGE_TOKEN obrigatório para expor a validação pública de cupons.'
    );
  }

  @Get('summary')
  summary(@Query('days') days?: string) {
    return this.service.getSummary({ days });
  }

  @Post('bank-statements/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STATEMENT_UPLOAD_MAX_BYTES } }))
  importBankStatement(
    @UploadedFile()
    file?: {
      buffer?: Buffer;
      mimetype?: string;
      originalname?: string;
      size?: number;
    }
  ) {
    return this.bankStatementsService.importUploadedStatement(file);
  }

  @Get('bank-statements/review')
  getBankStatementReview() {
    return this.bankStatementsService.getReviewSummary();
  }

  @Post('bank-statements/reprocess-latest')
  async reprocessLatestBankStatement() {
    const result = await this.bankStatementsService.reprocessLatestImport();
    return result.review;
  }

  @Get('bank-statements/transactions/:id/match-candidates')
  getBankStatementMatchCandidates(@Param('id') id: string) {
    return this.bankStatementsService.getTransactionMatchCandidates(parseWithSchema(idSchema, id));
  }

  @Put('bank-statements/transactions/:id')
  updateBankStatementTransaction(@Param('id') id: string, @Body() body: unknown) {
    return this.bankStatementsService.updateTransaction(
      parseWithSchema(idSchema, id),
      parseWithSchema(statementTransactionUpdateSchema, body),
    );
  }

  @Post('bank-statements/classification-options')
  createBankStatementClassificationOption(@Body() body: unknown) {
    return this.bankStatementsService.createClassificationOption(
      parseWithSchema(statementClassificationOptionSchema, body),
    );
  }

  @Put('bank-statements/classification-options/:id')
  updateBankStatementClassificationOption(@Param('id') id: string, @Body() body: unknown) {
    return this.bankStatementsService.updateClassificationOption(
      parseWithSchema(idSchema, id),
      parseWithSchema(statementClassificationOptionSchema, body),
    );
  }

  @Get('coupons')
  listCoupons() {
    return this.service.listCoupons();
  }

  @Get('coupons/analytics')
  listCouponAnalytics() {
    return this.service.listCouponAnalytics();
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
