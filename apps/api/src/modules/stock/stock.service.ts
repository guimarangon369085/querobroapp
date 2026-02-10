import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { StockMovementSchema } from '@querobroapp/shared';

@Injectable()
export class StockService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.stockMovement.findMany({
      include: { product: true, order: true },
      orderBy: { id: 'desc' }
    });
  }

  async create(payload: unknown) {
    const data = StockMovementSchema.omit({ id: true, createdAt: true }).parse(payload);
    const product = await this.prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new NotFoundException('Produto nao encontrado');

    if (data.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
    }

    return this.prisma.stockMovement.create({
      data: {
        productId: data.productId,
        type: data.type,
        quantity: data.quantity,
        reason: data.reason ?? null,
        orderId: data.orderId ?? null
      }
    });
  }
}
