import { Body, Controller, Get, Post, Inject } from '@nestjs/common';
import { StockService } from './stock.service.js';

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
}
