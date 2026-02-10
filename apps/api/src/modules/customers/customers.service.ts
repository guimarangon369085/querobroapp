import { Injectable, NotFoundException, Inject, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CustomerSchema } from '@querobroapp/shared';
import { normalizePhone, normalizeTitle, normalizeText } from '../../common/normalize.js';

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
    const firstName = normalizeTitle(data.firstName ?? undefined);
    const lastName = normalizeTitle(data.lastName ?? undefined);
    const fullName = normalizeTitle(data.name) ?? data.name;
    return this.prisma.customer.create({
      data: {
        ...data,
        name: fullName,
        firstName: firstName ?? (fullName.split(' ')[0] || null),
        lastName:
          lastName ??
          (fullName.split(' ').length > 1 ? fullName.split(' ').slice(1).join(' ') : null),
        email: data.email ? normalizeText(data.email)?.toLowerCase() ?? null : null,
        phone: normalizePhone(data.phone),
        address: normalizeTitle(data.address ?? undefined),
        addressLine1: normalizeTitle(data.addressLine1 ?? undefined),
        addressLine2: normalizeTitle(data.addressLine2 ?? undefined),
        neighborhood: normalizeTitle(data.neighborhood ?? undefined),
        city: normalizeTitle(data.city ?? undefined),
        state: normalizeText(data.state ?? undefined)?.toUpperCase() ?? null,
        postalCode: normalizeText(data.postalCode ?? undefined),
        country: normalizeTitle(data.country ?? undefined),
        placeId: normalizeText(data.placeId ?? undefined),
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        deliveryNotes: normalizeText(data.deliveryNotes ?? undefined)
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
        firstName: data.firstName !== undefined ? normalizeTitle(data.firstName) : undefined,
        lastName: data.lastName !== undefined ? normalizeTitle(data.lastName) : undefined,
        email: data.email !== undefined ? normalizeText(data.email)?.toLowerCase() ?? null : undefined,
        phone: data.phone !== undefined ? normalizePhone(data.phone) : undefined,
        address: data.address !== undefined ? normalizeTitle(data.address) ?? null : undefined,
        addressLine1: data.addressLine1 !== undefined ? normalizeTitle(data.addressLine1) ?? null : undefined,
        addressLine2: data.addressLine2 !== undefined ? normalizeTitle(data.addressLine2) ?? null : undefined,
        neighborhood: data.neighborhood !== undefined ? normalizeTitle(data.neighborhood) ?? null : undefined,
        city: data.city !== undefined ? normalizeTitle(data.city) ?? null : undefined,
        state: data.state !== undefined ? normalizeText(data.state)?.toUpperCase() ?? null : undefined,
        postalCode: data.postalCode !== undefined ? normalizeText(data.postalCode) ?? null : undefined,
        country: data.country !== undefined ? normalizeTitle(data.country) ?? null : undefined,
        placeId: data.placeId !== undefined ? normalizeText(data.placeId) ?? null : undefined,
        lat: data.lat !== undefined ? data.lat ?? null : undefined,
        lng: data.lng !== undefined ? data.lng ?? null : undefined,
        deliveryNotes: data.deliveryNotes !== undefined ? normalizeText(data.deliveryNotes) ?? null : undefined
      }
    });
  }

  async remove(id: number) {
    await this.get(id);
    const ordersCount = await this.prisma.order.count({ where: { customerId: id } });
    if (ordersCount > 0) {
      throw new ConflictException('Cliente possui pedidos vinculados.');
    }
    await this.prisma.customer.delete({ where: { id } });
  }
}
