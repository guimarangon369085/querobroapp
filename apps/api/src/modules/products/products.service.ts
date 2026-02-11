import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { ProductSchema } from '@querobroapp/shared';
import { normalizeMoney, normalizeText, normalizeTitle } from '../../common/normalize.js';

@Injectable()
export class ProductsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async ensureDefaultBom(
    tx: Prisma.TransactionClient,
    product: { id: number; name: string; unit: string | null }
  ) {
    const existing = await tx.bom.findFirst({
      where: { productId: product.id },
      orderBy: { id: 'asc' }
    });
    if (existing) return existing;

    return tx.bom.create({
      data: {
        productId: product.id,
        name: product.name,
        saleUnitLabel: product.unit,
        yieldUnits: null
      }
    });
  }

  list() {
    return this.prisma.product.findMany({ orderBy: { id: 'desc' } });
  }

  async get(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto nao encontrado');
    return product;
  }

  async getBom(id: number) {
    const product = await this.get(id);

    const existing = await this.prisma.bom.findFirst({
      where: { productId: id },
      include: { items: { include: { item: true } }, product: true },
      orderBy: { id: 'asc' }
    });
    if (existing) return existing;

    const created = await this.prisma.bom.create({
      data: {
        productId: id,
        name: product.name,
        saleUnitLabel: product.unit,
        yieldUnits: null
      },
      include: { items: { include: { item: true } }, product: true }
    });

    return created;
  }

  create(payload: unknown) {
    const data = ProductSchema.omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...data,
          name: normalizeTitle(data.name) ?? data.name,
          category: normalizeTitle(data.category ?? undefined),
          unit: normalizeText(data.unit ?? undefined)?.toLowerCase() ?? data.unit ?? null,
          price: normalizeMoney(data.price)
        }
      });

      await this.ensureDefaultBom(tx, {
        id: created.id,
        name: created.name,
        unit: created.unit ?? null
      });

      return created;
    });
  }

  async update(id: number, payload: unknown) {
    await this.get(id);
    const data = ProductSchema.partial().omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        name: data.name ? normalizeTitle(data.name) ?? data.name : undefined,
        category: data.category !== undefined ? normalizeTitle(data.category ?? undefined) : undefined,
        unit: data.unit !== undefined ? normalizeText(data.unit ?? undefined)?.toLowerCase() ?? null : undefined,
        price: data.price !== undefined ? normalizeMoney(data.price) : undefined
      }
    });
  }

  async remove(id: number) {
    await this.get(id);
    const [itemsCount, movementsCount, bomsCount] = await this.prisma.$transaction([
      this.prisma.orderItem.count({ where: { productId: id } }),
      this.prisma.stockMovement.count({ where: { productId: id } }),
      this.prisma.bom.count({ where: { productId: id } })
    ]);

    if (itemsCount > 0 || movementsCount > 0 || bomsCount > 0) {
      await this.prisma.product.update({
        where: { id },
        data: { active: false }
      });
      return { archived: true };
    }

    await this.prisma.product.delete({ where: { id } });
    return { deleted: true };
  }
}
