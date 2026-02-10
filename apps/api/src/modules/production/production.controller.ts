import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ProductionService } from './production.service.js';

@Controller('production')
export class ProductionController {
  constructor(@Inject(ProductionService) private readonly service: ProductionService) {}

  @Get('requirements')
  requirements(@Query('date') date?: string) {
    return this.service.requirements(date);
  }
}
