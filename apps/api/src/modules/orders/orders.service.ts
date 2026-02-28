import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { OrderItemSchema, OrderSchema, OrderStatusEnum } from '@querobroapp/shared';
import { z } from 'zod';

const updateSchema = OrderSchema.partial().omit({ id: true, createdAt: true, items: true });
const markPaidSchema = z.object({
  method: z.string().trim().min(1).optional(),
  paidAt: z.string().datetime().optional().nullable()
});

const statusTransitions: Record<string, string[]> = {
  ABERTO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EM_PREPARACAO', 'CANCELADO'],
  EM_PREPARACAO: ['PRONTO', 'CANCELADO'],
  PRONTO: ['ENTREGUE', 'CANCELADO'],
  ENTREGUE: [],
  CANCELADO: []
};

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; customer: true; payments: true };
}>;

@Injectable()
export class OrdersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private getPaidAmount(
    payments: Array<{
      amount: number;
      status: string;
      paidAt: Date | null;
    }>
  ) {
    return this.toMoney(
      payments.reduce((sum, payment) => {
        const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
        return isPaid ? sum + payment.amount : sum;
      }, 0)
    );
  }

  private deriveOrderPaymentStatus(total: number, amountPaid: number) {
    if (amountPaid <= 0) return 'PENDENTE';
    if (amountPaid + 0.00001 >= total) return 'PAGO';
    return 'PARCIAL';
  }

  private ensureOrderTotalCoversPaid(total: number, amountPaid: number) {
    const normalizedTotal = this.toMoney(total);
    const normalizedAmountPaid = this.toMoney(amountPaid);
    if (normalizedAmountPaid > normalizedTotal + 0.00001) {
      throw new BadRequestException(
        `Total do pedido nao pode ficar abaixo do valor ja pago. Total=${normalizedTotal} Pago=${normalizedAmountPaid}`
      );
    }
  }

  private parseOptionalDateTime(value: string | null | undefined) {
    if (value == null) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Data/hora do pedido invalida.');
    }
    return parsed;
  }

  private withFinancial(order: OrderWithRelations) {
    const total = this.toMoney(order.total ?? 0);
    const amountPaid = this.getPaidAmount(order.payments || []);
    const balanceDue = this.toMoney(Math.max(total - amountPaid, 0));
    const paymentStatus = this.deriveOrderPaymentStatus(total, amountPaid);
    return {
      ...order,
      amountPaid,
      balanceDue,
      paymentStatus
    };
  }

  private shouldQueueWhatsappStatus(status: string) {
    return ['CONFIRMADO', 'PRONTO', 'ENTREGUE'].includes(status);
  }

  private async queueOrderStatusOutbox(
    tx: Prisma.TransactionClient,
    order: OrderWithRelations,
    status: string
  ) {
    if (!this.shouldQueueWhatsappStatus(status)) return;
    const destination = order.customer?.phone?.trim();
    if (!destination) return;

    const amountPaid = this.getPaidAmount(order.payments || []);
    const payload = {
      event: 'ORDER_STATUS_CHANGED',
      orderId: order.id,
      status,
      customer: {
        id: order.customer?.id,
        name: order.customer?.name
      },
      totals: {
        total: this.toMoney(order.total ?? 0),
        amountPaid,
        balanceDue: this.toMoney(Math.max((order.total ?? 0) - amountPaid, 0)),
        paymentStatus: this.deriveOrderPaymentStatus(this.toMoney(order.total ?? 0), amountPaid)
      },
      createdAt: new Date().toISOString()
    };

    await tx.outboxMessage.create({
      data: {
        messageId: randomUUID(),
        channel: 'whatsapp',
        to: destination,
        template: 'order_status_changed',
        payload: JSON.stringify(payload),
        status: 'PENDING',
        orderId: order.id
      }
    });
  }

  private async getRaw(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true, payments: true }
    });
    if (!order) throw new NotFoundException('Pedido nao encontrado');
    return order;
  }

  async list() {
    const orders = await this.prisma.order.findMany({
      include: { items: true, customer: true, payments: true },
      orderBy: { id: 'desc' }
    });
    return orders.map((order) => this.withFinancial(order));
  }

  async get(id: number) {
    const order = await this.getRaw(id);
    return this.withFinancial(order);
  }

  async create(payload: unknown) {
    const data = OrderSchema.pick({ customerId: true, notes: true, discount: true, scheduledAt: true, items: true }).parse(
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
        const unitPrice = this.toMoney(product.price);
        const total = this.toMoney(unitPrice * item.quantity);
        subtotal += total;
        itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
      }

      subtotal = this.toMoney(subtotal);
      const discount = this.toMoney(data.discount ?? 0);
      const total = this.toMoney(Math.max(subtotal - discount, 0));

      const createdOrder = await tx.order.create({
        data: {
          customerId: data.customerId,
          notes: data.notes ?? null,
          scheduledAt: this.parseOptionalDateTime(data.scheduledAt),
          subtotal,
          discount,
          total,
          items: {
            create: itemsData
          }
        },
        include: { items: true, customer: true, payments: true }
      });

      return this.withFinancial(createdOrder);
    });
  }

  async update(id: number, payload: unknown) {
    const existing = await this.getRaw(id);
    const data = updateSchema.parse(payload);
    const nextScheduledAt = Object.prototype.hasOwnProperty.call(data, 'scheduledAt')
      ? this.parseOptionalDateTime(data.scheduledAt)
      : undefined;

    const subtotal = this.toMoney(existing.items.reduce((sum, item) => sum + item.total, 0));
    const discount = this.toMoney(data.discount ?? existing.discount ?? 0);
    const total = this.toMoney(Math.max(subtotal - discount, 0));
    const amountPaid = this.getPaidAmount(existing.payments || []);
    this.ensureOrderTotalCoversPaid(total, amountPaid);

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        notes: data.notes ?? undefined,
        discount,
        subtotal,
        total,
        ...(nextScheduledAt !== undefined ? { scheduledAt: nextScheduledAt } : {})
      },
      include: { items: true, customer: true, payments: true }
    });

    return this.withFinancial(updated);
  }

  async remove(id: number) {
    await this.getRaw(id);
    await this.prisma.order.delete({ where: { id } });
  }

  async addItem(orderId: number, payload: unknown) {
    const data = OrderItemSchema.pick({ productId: true, quantity: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (['CANCELADO', 'ENTREGUE'].includes(order.status)) {
        throw new BadRequestException('Pedido nao permite alterar itens neste status');
      }

      const product = await tx.product.findUnique({ where: { id: data.productId } });
      if (!product) throw new NotFoundException('Produto nao encontrado');

      const unitPrice = this.toMoney(product.price);
      const total = this.toMoney(unitPrice * data.quantity);

      await tx.orderItem.create({
        data: {
          orderId,
          productId: data.productId,
          quantity: data.quantity,
          unitPrice,
          total
        }
      });

      const newSubtotal = this.toMoney(order.items.reduce((sum, item) => sum + item.total, 0) + total);
      const newTotal = this.toMoney(Math.max(newSubtotal - order.discount, 0));
      await tx.order.update({ where: { id: orderId }, data: { subtotal: newSubtotal, total: newTotal } });

      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!updatedOrder) throw new NotFoundException('Pedido nao encontrado');
      return this.withFinancial(updatedOrder);
    });
  }

  async removeItem(orderId: number, itemId: number) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true }
      });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (['CANCELADO', 'ENTREGUE'].includes(order.status)) {
        throw new BadRequestException('Pedido nao permite alterar itens neste status');
      }

      const item = await tx.orderItem.findUnique({ where: { id: itemId } });
      if (!item || item.orderId !== orderId) throw new NotFoundException('Item nao encontrado');

      await tx.orderItem.delete({ where: { id: itemId } });

      const remaining = order.items.filter((i) => i.id !== itemId);
      const newSubtotal = this.toMoney(remaining.reduce((sum, i) => sum + i.total, 0));
      const newTotal = this.toMoney(Math.max(newSubtotal - order.discount, 0));
      const amountPaid = this.getPaidAmount(order.payments || []);
      this.ensureOrderTotalCoversPaid(newTotal, amountPaid);

      await tx.order.update({ where: { id: orderId }, data: { subtotal: newSubtotal, total: newTotal } });

      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!updatedOrder) throw new NotFoundException('Pedido nao encontrado');
      return this.withFinancial(updatedOrder);
    });
  }

  async updateStatus(orderId: number, nextStatus: unknown) {
    const status = OrderStatusEnum.parse(nextStatus);
    const order = await this.getRaw(orderId);

    const allowed = statusTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Transicao invalida: ${order.status} -> ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status },
        include: { items: true, customer: true, payments: true }
      });
      await this.queueOrderStatusOutbox(tx, updatedOrder, status);
      return this.withFinancial(updatedOrder);
    });
  }

  async markPaid(orderId: number, payload: unknown) {
    const data = markPaidSchema.parse(payload ?? {});

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (order.status === 'CANCELADO') {
        throw new BadRequestException('Nao e possivel registrar pagamento para pedido cancelado.');
      }

      const total = this.toMoney(order.total ?? 0);
      const amountPaid = this.getPaidAmount(order.payments || []);
      const balanceDue = this.toMoney(Math.max(total - amountPaid, 0));

      if (balanceDue <= 0) {
        return this.withFinancial(order);
      }

      await tx.payment.create({
        data: {
          orderId: order.id,
          amount: balanceDue,
          method: data.method?.trim() || 'pix',
          status: 'PAGO',
          paidAt: data.paidAt ? new Date(data.paidAt) : new Date()
        }
      });

      const updated = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!updated) throw new NotFoundException('Pedido nao encontrado');
      return this.withFinancial(updated);
    });
  }
}
