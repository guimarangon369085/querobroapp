import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive();

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

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
    return this.service.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.service.update(parseWithSchema(idSchema, id), body);
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

  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.removeItem(parseWithSchema(idSchema, id), parseWithSchema(idSchema, itemId));
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    return this.service.updateStatus(parseWithSchema(idSchema, id), body?.status);
  }
}
