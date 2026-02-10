import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { OrderItemSchema, OrderSchema, OrderStatusEnum } from '@querobroapp/shared';
import { z } from 'zod';

const updateSchema = OrderSchema.partial().omit({ id: true, createdAt: true, items: true });

const statusTransitions: Record<string, string[]> = {
  ABERTO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EM_PREPARACAO', 'CANCELADO'],
  EM_PREPARACAO: ['PRONTO', 'CANCELADO'],
  PRONTO: ['ENTREGUE', 'CANCELADO'],
  ENTREGUE: [],
  CANCELADO: []
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private parseSaleUnits(label?: string | null) {
    if (!label) return 1;
    const match = label.match(/(\d+)/);
    return match ? Number(match[1]) : 1;
  }

  private async applyInventoryMovements(
    tx: Prisma.TransactionClient,
    orderId: number,
    items: Array<{ productId: number; quantity: number }>,
    direction: 'OUT' | 'IN'
  ) {
    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const boms = await tx.bom.findMany({
      where: { productId: { in: productIds } },
      include: { items: true },
      orderBy: { id: 'asc' }
    });
    const bomMap = new Map<number, typeof boms[number]>();
    for (const bom of boms) {
      if (!bomMap.has(bom.productId)) {
        bomMap.set(bom.productId, bom);
      }
    }

    for (const item of items) {
      const bom = bomMap.get(item.productId);
      if (!bom) continue;
      const unitsPerSale = this.parseSaleUnits(bom.saleUnitLabel);

      for (const bomItem of bom.items) {
        let perSale = bomItem.qtyPerSaleUnit ?? null;
        if (perSale === null && bomItem.qtyPerUnit != null) {
          perSale = bomItem.qtyPerUnit * unitsPerSale;
        }
        if (perSale === null && bomItem.qtyPerRecipe != null && bom.yieldUnits) {
          perSale = bomItem.qtyPerRecipe / bom.yieldUnits;
        }
        if (perSale === null) continue;

        const qty = perSale * item.quantity;
        await tx.inventoryMovement.create({
          data: {
            itemId: bomItem.itemId,
            orderId,
            type: direction,
            quantity: qty,
            reason: direction === 'OUT' ? 'Consumo por pedido' : 'Estorno de pedido'
          }
        });
      }
    }
  }

  list() {
    return this.prisma.order.findMany({
      include: { items: true, customer: true, payments: true },
      orderBy: { id: 'desc' }
    });
  }

  async get(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true, payments: true }
    });
    if (!order) throw new NotFoundException('Pedido nao encontrado');
    return order;
  }

  async create(payload: unknown) {
    const data = OrderSchema.pick({ customerId: true, notes: true, discount: true, items: true }).parse(
      payload
    );
    const items = data.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException('Itens sao obrigatorios');
    }

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) throw new NotFoundException('Cliente nao encontrado');

      const parsedItems = items.map((item) =>
        OrderItemSchema.pick({ productId: true, quantity: true }).parse(item)
      );

      const productIds = Array.from(new Set(parsedItems.map((item) => item.productId)));
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((product) => [product.id, product]));

      let subtotal = 0;
      const itemsData = [] as Array<{ productId: number; quantity: number; unitPrice: number; total: number }>;
      for (const item of parsedItems) {
        const product = productMap.get(item.productId);
        if (!product) throw new NotFoundException('Produto nao encontrado');
        const unitPrice = product.price;
        const total = unitPrice * item.quantity;
        subtotal += total;
        itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
      }

      const discount = data.discount ?? 0;
      const total = Math.max(subtotal - discount, 0);

      return tx.order.create({
        data: {
          customerId: data.customerId,
          notes: data.notes ?? null,
          subtotal,
          discount,
          total,
          items: {
            create: itemsData
          }
        },
        include: { items: true, customer: true, payments: true }
      }).then(async (order) => {
        await this.applyInventoryMovements(
          tx,
          order.id,
          itemsData.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          'OUT'
        );
        return order;
      });
    });
  }

  async update(id: number, payload: unknown) {
    await this.get(id);
    const data = updateSchema.parse(payload);

    const discount = data.discount ?? undefined;
    return this.prisma.order.update({
      where: { id },
      data: {
        notes: data.notes ?? undefined,
        discount,
        subtotal: data.subtotal ?? undefined,
        total: data.total ?? undefined
      },
      include: { items: true, customer: true, payments: true }
    });
  }

  async remove(id: number) {
    const order = await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await this.applyInventoryMovements(
        tx,
        order.id,
        (order.items || []).map((item) => ({ productId: item.productId, quantity: item.quantity })),
        'IN'
      );
      await tx.order.delete({ where: { id } });
    });
  }

  async addItem(orderId: number, payload: unknown) {
    const data = OrderItemSchema.pick({ productId: true, quantity: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');

      const product = await tx.product.findUnique({ where: { id: data.productId } });
      if (!product) throw new NotFoundException('Produto nao encontrado');

      const unitPrice = product.price;
      const total = unitPrice * data.quantity;

      await tx.orderItem.create({
        data: {
          orderId,
          productId: data.productId,
          quantity: data.quantity,
          unitPrice,
          total
        }
      });

      const newSubtotal = order.items.reduce((sum, item) => sum + item.total, 0) + total;
      const newTotal = Math.max(newSubtotal - order.discount, 0);
      await tx.order.update({ where: { id: orderId }, data: { subtotal: newSubtotal, total: newTotal } });

      await this.applyInventoryMovements(
        tx,
        orderId,
        [{ productId: data.productId, quantity: data.quantity }],
        'OUT'
      );

      return tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
    });
  }

  async removeItem(orderId: number, itemId: number) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');

      const item = await tx.orderItem.findUnique({ where: { id: itemId } });
      if (!item || item.orderId !== orderId) throw new NotFoundException('Item nao encontrado');

      await tx.orderItem.delete({ where: { id: itemId } });

      const remaining = order.items.filter((i) => i.id !== itemId);
      const newSubtotal = remaining.reduce((sum, i) => sum + i.total, 0);
      const newTotal = Math.max(newSubtotal - order.discount, 0);

      await tx.order.update({ where: { id: orderId }, data: { subtotal: newSubtotal, total: newTotal } });

      await this.applyInventoryMovements(
        tx,
        orderId,
        [{ productId: item.productId, quantity: item.quantity }],
        'IN'
      );

      return tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
    });
  }

  async updateStatus(orderId: number, nextStatus: unknown) {
    const status = OrderStatusEnum.parse(nextStatus);
    const order = await this.get(orderId);

    const allowed = statusTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Transicao invalida: ${order.status} -> ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (status === 'CANCELADO' && order.status !== 'CANCELADO') {
        await this.applyInventoryMovements(
          tx,
          orderId,
          (order.items || []).map((item) => ({ productId: item.productId, quantity: item.quantity })),
          'IN'
        );
      }
      return tx.order.update({
        where: { id: orderId },
        data: { status },
        include: { items: true, customer: true, payments: true }
      });
    });
  }
}
