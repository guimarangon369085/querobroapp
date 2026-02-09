import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CustomerSchema } from '@querobroapp/shared';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.customer.findMany({ orderBy: { id: 'desc' } });
  }

  async get(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente nao encontrado');
    return customer;
  }

  create(payload: unknown) {
    const data = CustomerSchema.omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.customer.create({ data });
  }

  async update(id: number, payload: unknown) {
    await this.get(id);
    const data = CustomerSchema.partial().omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.get(id);
    await this.prisma.customer.delete({ where: { id } });
  }
}
