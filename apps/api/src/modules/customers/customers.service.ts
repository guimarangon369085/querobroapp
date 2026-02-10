import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CustomerSchema } from '@querobroapp/shared';
import { normalizePhone, normalizeTitle } from '../../common/normalize.js';

@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    return this.prisma.customer.create({
      data: {
        ...data,
        name: normalizeTitle(data.name) ?? data.name,
        phone: normalizePhone(data.phone),
        address: normalizeTitle(data.address ?? undefined)
      }
    });
  }

  async update(id: number, payload: unknown) {
    await this.get(id);
    const data = CustomerSchema.partial().omit({ id: true, createdAt: true }).parse(payload);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...data,
        name: data.name ? normalizeTitle(data.name) ?? data.name : undefined,
        phone: data.phone !== undefined ? normalizePhone(data.phone) : undefined,
        address: data.address !== undefined ? normalizeTitle(data.address) ?? null : undefined
      }
    });
  }

  async remove(id: number) {
    await this.get(id);
    await this.prisma.customer.delete({ where: { id } });
  }
}
