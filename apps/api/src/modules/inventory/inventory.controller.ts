import { Body, Controller, Get, Post } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';

@Controller()
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('inventory-items')
  listItems() {
    return this.service.listItems();
  }

  @Post('inventory-items')
  createItem(@Body() body: unknown) {
    return this.service.createItem(body);
  }

  @Get('inventory-movements')
  listMovements() {
    return this.service.listMovements();
  }

  @Post('inventory-movements')
  createMovement(@Body() body: unknown) {
    return this.service.createMovement(body);
  }
}
