import { Body, Controller, Get, Param, Patch, Post, Inject } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive();

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

  @Patch(':id/mark-paid')
  markPaid(@Param('id') id: string) {
    return this.service.markPaid(parseWithSchema(idSchema, id));
  }
}
