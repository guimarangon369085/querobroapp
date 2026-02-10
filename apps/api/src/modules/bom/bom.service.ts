import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { BomItemSchema, BomSchema } from '@querobroapp/shared';

type BomPayload = {
  productId: number;
  name: string;
  saleUnitLabel?: string | null;
  yieldUnits?: number | null;
  items?: Array<{
    itemId: number;
    qtyPerRecipe?: number | null;
    qtyPerSaleUnit?: number | null;
    qtyPerUnit?: number | null;
  }>;
};

@Injectable()
export class BomService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.bom.findMany({
      include: { items: { include: { item: true } }, product: true },
      orderBy: { id: 'asc' }
    });
  }

  async get(id: number) {
    const bom = await this.prisma.bom.findUnique({
      where: { id },
      include: { items: { include: { item: true } }, product: true }
    });
    if (!bom) throw new NotFoundException('BOM nao encontrado');
    return bom;
  }

  async create(payload: unknown) {
    const data = BomSchema.pick({
      productId: true,
      name: true,
      saleUnitLabel: true,
      yieldUnits: true
    }).parse(payload as BomPayload);

    const itemsPayload = (payload as BomPayload).items ?? [];
    const items = itemsPayload.map((item) =>
      BomItemSchema.pick({
        itemId: true,
        qtyPerRecipe: true,
        qtyPerSaleUnit: true,
        qtyPerUnit: true,
        bomId: true
      })
        .omit({ bomId: true })
        .parse({ ...item, bomId: 1 })
    );

    return this.prisma.bom.create({
      data: {
        productId: data.productId,
        name: data.name,
        saleUnitLabel: data.saleUnitLabel ?? null,
        yieldUnits: data.yieldUnits ?? null,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            qtyPerRecipe: item.qtyPerRecipe ?? null,
            qtyPerSaleUnit: item.qtyPerSaleUnit ?? null,
            qtyPerUnit: item.qtyPerUnit ?? null
          }))
        }
      },
      include: { items: true, product: true }
    });
  }

  async update(id: number, payload: unknown) {
    const data = BomSchema.pick({
      productId: true,
      name: true,
      saleUnitLabel: true,
      yieldUnits: true
    }).parse(payload as BomPayload);

    const itemsPayload = (payload as BomPayload).items ?? [];
    const items = itemsPayload.map((item) =>
      BomItemSchema.pick({
        itemId: true,
        qtyPerRecipe: true,
        qtyPerSaleUnit: true,
        qtyPerUnit: true,
        bomId: true
      })
        .omit({ bomId: true })
        .parse({ ...item, bomId: id })
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.bom.update({
        where: { id },
        data: {
          productId: data.productId,
          name: data.name,
          saleUnitLabel: data.saleUnitLabel ?? null,
          yieldUnits: data.yieldUnits ?? null
        }
      });

      await tx.bomItem.deleteMany({ where: { bomId: id } });
      if (items.length > 0) {
        await tx.bomItem.createMany({
          data: items.map((item) => ({
            bomId: id,
            itemId: item.itemId,
            qtyPerRecipe: item.qtyPerRecipe ?? null,
            qtyPerSaleUnit: item.qtyPerSaleUnit ?? null,
            qtyPerUnit: item.qtyPerUnit ?? null
          }))
        });
      }

      return tx.bom.findUnique({
        where: { id },
        include: { items: { include: { item: true } }, product: true }
      });
    });
  }
}
