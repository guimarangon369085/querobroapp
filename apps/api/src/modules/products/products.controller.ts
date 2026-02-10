import { Controller, Delete, Get, Param, Body, Post, Put, Inject } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';
import { ProductSchema } from '@querobroapp/shared';

const idSchema = z.coerce.number().int().positive();

@Controller('products')
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly service: ProductsService) {}

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
    const payload = ProductSchema.omit({ id: true, createdAt: true }).parse(body);
    return this.service.create(payload);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const productId = parseWithSchema(idSchema, id);
    const payload = ProductSchema.partial().omit({ id: true, createdAt: true }).parse(body);
    return this.service.update(productId, payload);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseWithSchema(idSchema, id));
  }
}
