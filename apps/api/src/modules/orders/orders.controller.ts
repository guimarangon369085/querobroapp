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

@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly service: OrdersService) {}

  private assertExternalFormAccess(authorization?: string | null, explicitToken?: string | null) {
    const configuredToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const providedToken = String(explicitToken || '').trim() || extractBearerToken(authorization);

    if (configuredToken) {
      if (providedToken === configuredToken) return;
      throw new UnauthorizedException('Token do bridge de formulario invalido.');
    }

    if (getSecurityRuntimeConfig().enabled) {
      throw new UnauthorizedException(
        'ORDER_FORM_BRIDGE_TOKEN obrigatorio para expor intake de formulario externo com auth ligada.'
      );
    }
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get('mass-prep-events')
  listMassPrepEvents() {
    return this.service.listMassPrepEvents();
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
    @Headers('x-order-form-token') formToken?: string
  ) {
    this.assertExternalFormAccess(authorization, formToken);
    return this.service.intakeCustomerForm(body);
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
  getPublicScheduleAvailability(@Query('scheduledAt') scheduledAt?: string) {
    return this.service.getPublicScheduleAvailability(scheduledAt ?? null);
  }

  @Get(':id/pix-charge')
  pixCharge(@Param('id') id: string) {
    return this.service.getPixCharge(parseWithSchema(idSchema, id));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(parseWithSchema(idSchema, id));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.service.update(parseWithSchema(idSchema, id), body);
  }

  @Delete(':id/mass-prep-event')
  async removeMassPrepEvent(@Param('id') id: string) {
    await this.service.removeMassPrepEvent(parseWithSchema(idSchema, id));
    return { ok: true };
  }

  @Patch(':id/mass-prep-event/status')
  updateMassPrepEventStatus(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateMassPrepEventStatus(parseWithSchema(idSchema, id), body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseWithSchema(idSchema, id));
    return { ok: true };
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() body: unknown) {
    return this.service.addItem(parseWithSchema(idSchema, id), body);
  }

  @Put(':id/items')
  replaceItems(@Param('id') id: string, @Body() body: unknown) {
    return this.service.replaceItems(parseWithSchema(idSchema, id), body);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.removeItem(parseWithSchema(idSchema, id), parseWithSchema(idSchema, itemId));
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    return this.service.updateStatus(parseWithSchema(idSchema, id), body?.status);
  }

  @Patch(':id/mark-paid')
  markPaid(@Param('id') id: string, @Body() body: unknown) {
    return this.service.markPaid(parseWithSchema(idSchema, id), body);
  }
}
