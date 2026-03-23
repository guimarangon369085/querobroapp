import { Body, Controller, Get, Param, Post, Put, Delete, Inject, UploadedFile, UseInterceptors } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import {
  InventoryProductsService,
  PRODUCT_IMAGE_MAX_UPLOAD_BYTES
} from './inventory-products.service.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';
import { FileInterceptor } from '@nestjs/platform-express';

const idSchema = z.coerce.number().int().positive();

@Controller()
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly service: InventoryService,
    @Inject(InventoryProductsService) private readonly productsService: InventoryProductsService
  ) {}

  @Get('inventory-products')
  listProducts() {
    return this.productsService.list();
  }

  @Get('inventory-products/:id')
  getProduct(@Param('id') id: string) {
    return this.productsService.get(parseWithSchema(idSchema, id));
  }

  @Post('inventory-products')
  createProduct(@Body() body: unknown) {
    return this.productsService.create(body);
  }

  @Post('inventory-products/image-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PRODUCT_IMAGE_MAX_UPLOAD_BYTES } }))
  uploadProductImage(
    @UploadedFile()
    file?: {
      buffer?: Buffer;
      mimetype?: string;
      originalname?: string;
      size?: number;
    }
  ) {
    return this.productsService.uploadImage(file);
  }

  @Put('inventory-products/:id')
  updateProduct(@Param('id') id: string, @Body() body: unknown) {
    return this.productsService.update(parseWithSchema(idSchema, id), body);
  }

  @Delete('inventory-products/:id')
  removeProduct(@Param('id') id: string) {
    return this.productsService.remove(parseWithSchema(idSchema, id));
  }

  @Get('inventory-items')
  listItems() {
    return this.service.listItems();
  }

  @Get('inventory-overview')
  overview() {
    return this.service.overview();
  }

  @Post('inventory-items')
  createItem(@Body() body: unknown) {
    return this.service.createItem(body);
  }

  @Put('inventory-items/:id')
  updateItem(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateItem(parseWithSchema(idSchema, id), body);
  }

  @Post('inventory-items/refresh-purchase-costs')
  refreshPurchaseCosts() {
    return this.service.refreshPurchaseCosts();
  }

  @Post('inventory-items/:id/effective-balance')
  adjustEffectiveBalance(@Param('id') id: string, @Body() body: unknown) {
    return this.service.adjustEffectiveBalance(parseWithSchema(idSchema, id), body);
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

  @Post('inventory-mass-ready/prepare')
  prepareMassReady(@Body() body: unknown) {
    return this.service.prepareMassReady(body);
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
