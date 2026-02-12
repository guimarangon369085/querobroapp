import { Body, Controller, Get, Param, Post, Put, Delete, Inject, Query } from '@nestjs/common';
import { BomService } from './bom.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive();

@Controller('boms')
export class BomController {
  constructor(@Inject(BomService) private readonly service: BomService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.service.create(body);
  }

  @Post('bootstrap/broa')
  bootstrapBroa() {
    return this.service.bootstrapBroaPreset();
  }

  @Get('flavor-combinations')
  flavorCombinations(@Query('units') units?: string) {
    const parsedUnits = units ? Number(units) : 7;
    return this.service.listFlavorCombinations(parsedUnits);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(parseWithSchema(idSchema, id));
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
}
