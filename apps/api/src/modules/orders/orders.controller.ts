import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Put,
  UnauthorizedException
} from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrderDailyDigestService } from './order-daily-digest.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';
import { EXTERNAL_ORDER_DELIVERY_WINDOWS, ExternalOrderDeliveryWindowKeyEnum } from '@querobroapp/shared';
import { Public } from '../../security/public.decorator.js';
import { getSecurityRuntimeConfig } from '../../security/security-config.js';

const idSchema = z.coerce.number().int().positive();
const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const digestSendBodySchema = z.object({
  date: dayKeySchema.optional(),
  force: z.coerce.boolean().optional()
});
const updateScheduleDayBodySchema = z.object({
  blockedWindows: z.array(ExternalOrderDeliveryWindowKeyEnum).optional(),
  isOpen: z.boolean().optional()
});
const digestPreviewQuerySchema = z.object({
  date: dayKeySchema.optional()
});

function currentSaoPauloDateKey() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function extractBearerToken(authHeader?: string | null) {
  const value = String(authHeader || '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly service: OrdersService,
    @Inject(OrderDailyDigestService) private readonly dailyDigest: OrderDailyDigestService
  ) {}

  private assertExternalFormAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge de formulário inválido.');
    }

    if (getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException(
        'ORDER_FORM_BRIDGE_TOKEN obrigatório para expor intake de formulário externo com auth ligada.'
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

  @Post('intake')
  intake(@Body() body: unknown) {
    return this.service.intake(body);
  }

  @Public()
  @Post('intake/customer-form/preview')
  previewCustomerForm(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-order-form-token') formToken?: string
  ) {
    this.assertExternalFormAccess(authorization, formToken);
    return this.service.previewCustomerForm(body);
  }

  @Public()
  @Post('intake/customer-form')
  intakeCustomerForm(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-order-form-token') formToken?: string,
    @Headers('x-public-app-origin') publicAppOrigin?: string
  ) {
    this.assertExternalFormAccess(authorization, formToken);
    return this.service.intakeCustomerForm(body, {
      publicAppOrigin: publicAppOrigin ?? null
    });
  }

  @Public()
  @Post('intake/google-form/preview')
  previewGoogleForm(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-order-form-token') formToken?: string
  ) {
    this.assertExternalFormAccess(authorization, formToken);
    return this.service.previewGoogleForm(body);
  }

  @Public()
  @Post('intake/google-form')
  intakeGoogleForm(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-order-form-token') formToken?: string
  ) {
    this.assertExternalFormAccess(authorization, formToken);
    return this.service.intakeGoogleForm(body);
  }

  @Public()
  @Get('public-schedule')
  getPublicScheduleAvailability(
    @Query('date') date?: string,
    @Query('timeWindow') timeWindow?: string,
    @Query('scheduledAt') scheduledAt?: string,
    @Query('totalBroas') totalBroas?: string
  ) {
    const parsedTotalBroas = totalBroas == null || totalBroas === '' ? null : Number(totalBroas);
    return this.service.getPublicScheduleAvailability(
      date ?? null,
      timeWindow ?? null,
      scheduledAt ?? null,
      Number.isFinite(parsedTotalBroas) ? parsedTotalBroas : null
    );
  }

  @Get('schedule-days/:dayKey')
  getScheduleDayAvailability(@Param('dayKey') dayKey: string) {
    return this.service.getScheduleDayAvailability(parseWithSchema(dayKeySchema, dayKey));
  }

  @Post('daily-digest/send')
  sendDailyDigest(@Body() body: unknown) {
    const parsed = parseWithSchema(digestSendBodySchema, body ?? {});
    return this.dailyDigest.sendForDate(parsed.date || currentSaoPauloDateKey(), { force: parsed.force === true });
  }

  @Get('daily-digest/preview')
  previewDailyDigest(@Query() query: unknown) {
    const parsed = parseWithSchema(digestPreviewQuerySchema, query ?? {});
    return this.dailyDigest.previewForDate(parsed.date || currentSaoPauloDateKey());
  }

  @Put('schedule-days/:dayKey')
  updateScheduleDayAvailability(
    @Param('dayKey') dayKey: string,
    @Body() body: unknown,
  ) {
    const parsed = parseWithSchema(updateScheduleDayBodySchema, body ?? {});
    const blockedWindows =
      parsed.blockedWindows ??
      (parsed.isOpen === false ? EXTERNAL_ORDER_DELIVERY_WINDOWS.map((window) => window.key) : []);
    return this.service.updateScheduleDayAvailability(
      parseWithSchema(dayKeySchema, dayKey),
      blockedWindows,
    );
  }

  @Get(':id(\\d+)/pix-charge')
  pixCharge(@Param('id') id: string) {
    return this.service.getPixCharge(parseWithSchema(idSchema, id));
  }

  @Get(':id(\\d+)')
  get(@Param('id') id: string) {
    return this.service.get(parseWithSchema(idSchema, id));
  }

  @Put(':id(\\d+)')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.service.update(parseWithSchema(idSchema, id), body);
  }

  @Delete(':id(\\d+)')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseWithSchema(idSchema, id));
    return { ok: true };
  }

  @Post(':id(\\d+)/items')
  addItem(@Param('id') id: string, @Body() body: unknown) {
    return this.service.addItem(parseWithSchema(idSchema, id), body);
  }

  @Put(':id(\\d+)/items')
  replaceItems(@Param('id') id: string, @Body() body: unknown) {
    return this.service.replaceItems(parseWithSchema(idSchema, id), body);
  }

  @Delete(':id(\\d+)/items/:itemId(\\d+)')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.removeItem(parseWithSchema(idSchema, id), parseWithSchema(idSchema, itemId));
  }

  @Patch(':id(\\d+)/status')
  updateStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    return this.service.updateStatus(parseWithSchema(idSchema, id), body?.status);
  }

  @Patch(':id(\\d+)/mark-paid')
  markPaid(@Param('id') id: string, @Body() body: unknown) {
    return this.service.markPaid(parseWithSchema(idSchema, id), body);
  }
}
