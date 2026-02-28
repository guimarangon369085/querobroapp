import { Body, Controller, Get, Param, Post, Put, Delete, Inject } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive();

@Controller()
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly service: InventoryService) {}

  @Get('inventory-items')
  listItems() {
    return this.service.listItems();
  }

  @Post('inventory-items')
  createItem(@Body() body: unknown) {
    return this.service.createItem(body);
  }

  @Put('inventory-items/:id')
  updateItem(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateItem(parseWithSchema(idSchema, id), body);
  }

  @Delete('inventory-items/:id')
  async removeItem(@Param('id') id: string) {
    await this.service.removeItem(parseWithSchema(idSchema, id));
    return { ok: true };
  }

  @Get('inventory-movements')
  listMovements() {
    return this.service.listMovements();
  }

  @Post('inventory-movements')
  createMovement(@Body() body: unknown) {
    return this.service.createMovement(body);
  }

  @Delete('inventory-movements/:id')
  async removeMovement(@Param('id') id: string) {
    await this.service.removeMovement(parseWithSchema(idSchema, id));
    return { ok: true };
  }

  @Delete('inventory-movements')
  clearAllMovements() {
    return this.service.clearAllMovements();
  }
}
