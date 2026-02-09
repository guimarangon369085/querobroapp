import { Controller, Delete, Get, Param, Body, Post, Put } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';
import { CustomerSchema } from '@querobroapp/shared';

const idSchema = z.coerce.number().int().positive();

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(parseWithSchema(idSchema, id));
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = CustomerSchema.omit({ id: true, createdAt: true }).parse(body);
    return this.service.create(payload);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const customerId = parseWithSchema(idSchema, id);
    const payload = CustomerSchema.partial().omit({ id: true, createdAt: true }).parse(body);
    return this.service.update(customerId, payload);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseWithSchema(idSchema, id));
    return { ok: true };
  }
}
