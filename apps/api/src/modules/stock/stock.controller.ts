import { Body, Controller, Get, Post, Delete, Param, Inject } from '@nestjs/common';
import { StockService } from './stock.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive();

@Controller('stock-movements')
export class StockController {
  constructor(@Inject(StockService) private readonly service: StockService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.service.create(body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseWithSchema(idSchema, id));
    return { ok: true };
  }
}
