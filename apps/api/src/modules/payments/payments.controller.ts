import { Body, Controller, Get, Param, Post, Delete, Inject } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive();
const checkoutIdSchema = z.string().trim().min(1).max(160);

@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly service: PaymentsService) {}

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

  @Post('sumup/webhook')
  sumupWebhook(@Body() body: unknown) {
    return this.service.handleSumUpWebhook(body);
  }

  @Post('sumup/checkouts/:checkoutId/sync')
  syncSumUpCheckout(@Param('checkoutId') checkoutId: string) {
    return this.service.syncSumUpCheckoutById(parseWithSchema(checkoutIdSchema, checkoutId));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseWithSchema(idSchema, id));
    return { ok: true };
  }
}
