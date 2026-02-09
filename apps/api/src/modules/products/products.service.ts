import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { ProductSchema } from '@querobroapp/shared';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.product.findMany({ orderBy: { id: 'desc' } });
  }

  async get(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto nao encontrado');
    return product;
  }

  create(payload: unknown) {
    const data = ProductSchema.omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.product.create({ data });
  }

  async update(id: number, payload: unknown) {
    await this.get(id);
    const data = ProductSchema.partial().omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.product.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.get(id);
    await this.prisma.product.delete({ where: { id } });
  }
}
