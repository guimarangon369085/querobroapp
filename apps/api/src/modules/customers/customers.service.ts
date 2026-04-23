import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { CustomerAddressSchema, CustomerSchema, resolveDisplayNumber } from '@querobroapp/shared';
import { normalizePhone, normalizeTitle, normalizeText } from '../../common/normalize.js';
import { allocateNextPublicNumber } from '../../common/public-sequence.js';
import { resolveStoredCouponCode } from '../../common/coupons.js';
import {
  customerAddressIdentityKey,
  inferAddressLine1,
  inferCustomerNameParts,
  normalizeCustomerAddressPayload,
  normalizeNeighborhood
} from '../../common/customer-profile.js';

type CustomerPayload = ReturnType<typeof CustomerSchema.parse>;
type CustomerCreatePayload = Omit<CustomerPayload, 'id' | 'createdAt' | 'addresses'>;
type CustomerUpdatePayload = Partial<CustomerCreatePayload>;
type CustomerAddressCreatePayload = Omit<
  ReturnType<typeof CustomerAddressSchema.parse>,
  'id' | 'customerId' | 'createdAt' | 'updatedAt' | 'isPrimary'
>;
type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private shouldPromoteAutofillValue(currentValue?: string | null, inferredValue?: string | null) {
    const current = normalizeText(currentValue ?? undefined) ?? '';
    const inferred = normalizeText(inferredValue ?? undefined) ?? '';
    if (!inferred) return false;
    if (!current) return true;
    if (current.length <= 2 && inferred.length > current.length && inferred.toLowerCase().startsWith(current.toLowerCase())) {
      return true;
    }
    return false;
  }

  private pickPromotedTitle(currentValue?: string | null, inferredValue?: string | null) {
    if (this.shouldPromoteAutofillValue(currentValue, inferredValue)) {
      return normalizeTitle(inferredValue ?? undefined) ?? null;
    }
    return normalizeTitle(currentValue ?? undefined) ?? null;
  }

  private normalizeCustomerAutofillView<T extends { name: string; firstName: string | null; lastName: string | null; address: string | null; addressLine1: string | null }>(
    customer: T
  ): T {
    const inferredName = inferCustomerNameParts(customer.name);
    const inferredAddressLine1 = inferAddressLine1(customer.address);

    return {
      ...customer,
      firstName: this.pickPromotedTitle(customer.firstName, inferredName.firstName) ?? inferredName.firstName,
      lastName: this.pickPromotedTitle(customer.lastName, inferredName.lastName) ?? inferredName.lastName,
      addressLine1:
        this.pickPromotedTitle(customer.addressLine1, inferredAddressLine1) ?? inferredAddressLine1
    };
  }

  private customerAddressInclude(): Prisma.CustomerInclude {
    return {
      addresses: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      }
    };
  }

  private async saveCustomerAddress(
    tx: TransactionClient,
    customerId: number,
    payload: CustomerAddressCreatePayload,
    options?: { primary?: boolean }
  ) {
    const normalized = normalizeCustomerAddressPayload(payload);
    const addressKey = customerAddressIdentityKey(normalized);
    if (!addressKey) return null;

    const existing = await tx.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    const matched = existing.find((entry) => customerAddressIdentityKey(entry) === addressKey) || null;
    const shouldBePrimary = options?.primary === true;

    if (shouldBePrimary) {
      await tx.customerAddress.updateMany({
        where: { customerId, isPrimary: true, ...(matched ? { id: { not: matched.id } } : {}) },
        data: { isPrimary: false }
      });
    }

    if (matched) {
      return tx.customerAddress.update({
        where: { id: matched.id },
        data: {
          ...normalized,
          isPrimary: shouldBePrimary ? true : matched.isPrimary
        }
      });
    }

    return tx.customerAddress.create({
      data: {
        customerId,
        ...normalized,
        isPrimary: shouldBePrimary
      }
    });
  }

  private async buildCustomerCouponUsage(customerId: number) {
    const orders = await this.prisma.order.findMany({
      where: {
        customerId,
        status: {
          not: 'CANCELADO'
        }
      },
      select: {
        couponCode: true,
        notes: true,
        createdAt: true
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    const usageByCode = new Map<string, { code: string; uses: number; lastUsedAt: string | null }>();
    for (const order of orders) {
      const code = resolveStoredCouponCode(order.couponCode, order.notes);
      if (!code) continue;
      const current = usageByCode.get(code) || {
        code,
        uses: 0,
        lastUsedAt: null
      };
      current.uses += 1;
      const createdAtIso = order.createdAt?.toISOString?.() || null;
      if (!current.lastUsedAt || (createdAtIso && createdAtIso > current.lastUsedAt)) {
        current.lastUsedAt = createdAtIso;
      }
      usageByCode.set(code, current);
    }

    return Array.from(usageByCode.values()).sort(
      (left, right) =>
        String(right.lastUsedAt || '').localeCompare(String(left.lastUsedAt || '')) ||
        left.code.localeCompare(right.code, 'pt-BR')
    );
  }

  list() {
    return this.prisma.customer
      .findMany({
      where: { deletedAt: null },
      include: this.customerAddressInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })
      .then((customers) => customers.map((customer) => this.normalizeCustomerAutofillView(customer)));
  }

  async get(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: this.customerAddressInclude()
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return {
      ...this.normalizeCustomerAutofillView(customer),
      couponUsage: await this.buildCustomerCouponUsage(customer.id)
    };
  }

  create(payload: unknown) {
    const data = CustomerSchema.omit({ id: true, publicNumber: true, createdAt: true, addresses: true }).parse(payload) as CustomerCreatePayload;
    const inferredName = inferCustomerNameParts(data.name);
    const fullName = inferredName.fullName || data.name;
    const firstName = this.pickPromotedTitle(data.firstName, inferredName.firstName) ?? inferredName.firstName;
    const lastName = this.pickPromotedTitle(data.lastName, inferredName.lastName) ?? inferredName.lastName;
    const normalizedPhone = normalizePhone(data.phone);
    const normalizedAddressPayload = normalizeCustomerAddressPayload(data);
    const addressLine1 = this.pickPromotedTitle(data.addressLine1, normalizedAddressPayload.addressLine1) ?? normalizedAddressPayload.addressLine1;

    return this.prisma.$transaction(async (tx) => {
      const existingByPhone = normalizedPhone
        ? await tx.customer.findFirst({
            where: { deletedAt: null, phone: normalizedPhone },
            orderBy: { id: 'desc' }
          })
        : null;
      const reusableCustomer = existingByPhone;

      if (reusableCustomer) {
        const updated = await tx.customer.update({
          where: { id: reusableCustomer.id },
          data: {
            publicNumber: reusableCustomer.publicNumber ?? (await allocateNextPublicNumber(tx, 'CUSTOMER')),
            name: reusableCustomer.name || fullName,
            firstName: reusableCustomer.firstName || firstName,
            lastName: reusableCustomer.lastName || lastName,
            activePhoneKey: reusableCustomer.activePhoneKey || normalizedPhone,
            phone: reusableCustomer.phone || normalizedPhone,
            address: reusableCustomer.address || normalizedAddressPayload.address,
            addressLine1: reusableCustomer.addressLine1 || addressLine1,
            addressLine2: reusableCustomer.addressLine2 || normalizedAddressPayload.addressLine2,
            neighborhood: reusableCustomer.neighborhood || normalizedAddressPayload.neighborhood,
            city: reusableCustomer.city || normalizedAddressPayload.city,
            state: reusableCustomer.state || normalizedAddressPayload.state,
            postalCode: reusableCustomer.postalCode || normalizedAddressPayload.postalCode,
            country: reusableCustomer.country || normalizedAddressPayload.country,
            placeId: reusableCustomer.placeId || normalizedAddressPayload.placeId,
            lat: reusableCustomer.lat ?? normalizedAddressPayload.lat,
            lng: reusableCustomer.lng ?? normalizedAddressPayload.lng,
            deliveryNotes: reusableCustomer.deliveryNotes || normalizedAddressPayload.deliveryNotes
          }
        });
        await this.saveCustomerAddress(
          tx,
          updated.id,
          {
            address: updated.address,
            addressLine1: updated.addressLine1,
            addressLine2: updated.addressLine2,
            neighborhood: updated.neighborhood,
            city: updated.city,
            state: updated.state,
            postalCode: updated.postalCode,
            country: updated.country,
            placeId: updated.placeId,
            lat: updated.lat,
            lng: updated.lng,
            deliveryNotes: updated.deliveryNotes
          },
          { primary: true }
        );
        return tx.customer.findUniqueOrThrow({
          where: { id: reusableCustomer.id },
          include: this.customerAddressInclude()
        });
      }

      const created = await tx.customer.create({
        data: {
          ...data,
          publicNumber: await allocateNextPublicNumber(tx, 'CUSTOMER'),
          name: fullName,
          firstName,
          lastName,
          activePhoneKey: normalizedPhone,
          phone: normalizedPhone,
          address: normalizedAddressPayload.address,
          addressLine1,
          addressLine2: normalizedAddressPayload.addressLine2,
          neighborhood: normalizedAddressPayload.neighborhood,
          city: normalizedAddressPayload.city,
          state: normalizedAddressPayload.state,
          postalCode: normalizedAddressPayload.postalCode,
          country: normalizedAddressPayload.country,
          placeId: normalizedAddressPayload.placeId,
          lat: normalizedAddressPayload.lat,
          lng: normalizedAddressPayload.lng,
          deliveryNotes: normalizedAddressPayload.deliveryNotes
        }
      });
      await this.saveCustomerAddress(tx, created.id, normalizedAddressPayload, { primary: true });
      return tx.customer.findUniqueOrThrow({
        where: { id: created.id },
        include: this.customerAddressInclude()
      });
    });
  }

  async update(id: number, payload: unknown) {
    const existing = await this.get(id);
    const data = CustomerSchema.partial()
      .omit({ id: true, publicNumber: true, createdAt: true, addresses: true })
      .parse(payload) as CustomerUpdatePayload;

    const nextName = data.name !== undefined ? normalizeTitle(data.name) ?? data.name : existing.name;
    const inferredName = inferCustomerNameParts(nextName);
    const shouldRecomputeName =
      data.name !== undefined || data.firstName !== undefined || data.lastName !== undefined;
    const firstName = shouldRecomputeName
      ? this.pickPromotedTitle(
          data.firstName !== undefined ? data.firstName : existing.firstName,
          inferredName.firstName
        )
      : undefined;
    const lastName = shouldRecomputeName
      ? this.pickPromotedTitle(
          data.lastName !== undefined ? data.lastName : existing.lastName,
          inferredName.lastName
        )
      : undefined;

    const nextAddress = data.address !== undefined ? normalizeTitle(data.address) ?? null : existing.address;
    const shouldRecomputeAddressLine1 = data.address !== undefined || data.addressLine1 !== undefined;
    const inferredAddressLine1 = inferAddressLine1(nextAddress);
    const addressLine1 = shouldRecomputeAddressLine1
      ? this.pickPromotedTitle(
          data.addressLine1 !== undefined ? data.addressLine1 : existing.addressLine1,
          inferredAddressLine1
        )
      : undefined;
    const normalizedPhone = data.phone !== undefined ? normalizePhone(data.phone) : undefined;

    if (normalizedPhone) {
      const conflict = await this.prisma.customer.findFirst({
        where: {
          deletedAt: null,
          phone: normalizedPhone,
          id: { not: id }
        },
        orderBy: { id: 'desc' }
      });
      if (conflict) {
        throw new BadRequestException(
          `Telefone já vinculado ao cliente #${resolveDisplayNumber(conflict) ?? conflict.id}.`
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: {
          ...data,
          name: data.name ? normalizeTitle(data.name) ?? data.name : undefined,
          firstName,
          lastName,
          activePhoneKey: normalizedPhone,
          phone: normalizedPhone,
          address: data.address !== undefined ? normalizeTitle(data.address) ?? null : undefined,
          addressLine1,
          addressLine2: data.addressLine2 !== undefined ? normalizeTitle(data.addressLine2) ?? null : undefined,
          neighborhood: data.neighborhood !== undefined ? normalizeNeighborhood(data.neighborhood) : undefined,
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
      await this.saveCustomerAddress(
        tx,
        updated.id,
        {
          address: updated.address,
          addressLine1: updated.addressLine1,
          addressLine2: updated.addressLine2,
          neighborhood: updated.neighborhood,
          city: updated.city,
          state: updated.state,
          postalCode: updated.postalCode,
          country: updated.country,
          placeId: updated.placeId,
          lat: updated.lat,
          lng: updated.lng,
          deliveryNotes: updated.deliveryNotes
        },
        { primary: true }
      );
      return tx.customer.findUniqueOrThrow({
        where: { id: updated.id },
        include: this.customerAddressInclude()
      });
    });
  }

  async addAddress(id: number, payload: unknown) {
    const existing = await this.prisma.customer.findUnique({
      where: { id },
      include: this.customerAddressInclude()
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Cliente não encontrado');
    }

    const data = CustomerAddressSchema.omit({
      id: true,
      customerId: true,
      createdAt: true,
      updatedAt: true
    }).parse(payload) as CustomerAddressCreatePayload;

    return this.prisma.$transaction(async (tx) => {
      await this.saveCustomerAddress(tx, id, data, { primary: false });
      return tx.customer.findUniqueOrThrow({
        where: { id },
        include: this.customerAddressInclude()
      });
    });
  }

  async updateAddress(customerId: number, addressId: number, payload: unknown) {
    const existing = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: this.customerAddressInclude()
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Cliente não encontrado');
    }

    const address = existing.addresses.find((entry) => entry.id === addressId) || null;
    if (!address) {
      throw new NotFoundException('Endereço não encontrado');
    }

    const data = CustomerAddressSchema.omit({
      id: true,
      customerId: true,
      createdAt: true,
      updatedAt: true,
      isPrimary: true
    }).parse(payload) as CustomerAddressCreatePayload;
    const normalized = normalizeCustomerAddressPayload(data);

    return this.prisma.$transaction(async (tx) => {
      const updatedAddress = await tx.customerAddress.update({
        where: { id: addressId },
        data: normalized
      });

      if (address.isPrimary) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            address: updatedAddress.address,
            addressLine1: updatedAddress.addressLine1,
            addressLine2: updatedAddress.addressLine2,
            neighborhood: updatedAddress.neighborhood,
            city: updatedAddress.city,
            state: updatedAddress.state,
            postalCode: updatedAddress.postalCode,
            country: updatedAddress.country,
            placeId: updatedAddress.placeId,
            lat: updatedAddress.lat,
            lng: updatedAddress.lng,
            deliveryNotes: updatedAddress.deliveryNotes
          }
        });
      }

      return tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        include: this.customerAddressInclude()
      });
    });
  }

  async removeAddress(customerId: number, addressId: number) {
    const existing = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: this.customerAddressInclude()
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Cliente não encontrado');
    }

    const address = existing.addresses.find((entry) => entry.id === addressId) || null;
    if (!address) {
      throw new NotFoundException('Endereço não encontrado');
    }

    if (address.isPrimary) {
      throw new BadRequestException('O endereço principal deve ser editado, não excluído.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({
        where: { id: addressId }
      });

      return tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        include: this.customerAddressInclude()
      });
    });
  }

  async remove(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    if (customer.deletedAt) {
      return;
    }
    await this.prisma.customer.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        activePhoneKey: null
      }
    });
  }
}
