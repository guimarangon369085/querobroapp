import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { CustomerSchema } from '@querobroapp/shared';
import { normalizePhone, normalizeTitle, normalizeText } from '../../common/normalize.js';

type CustomerPayload = ReturnType<typeof CustomerSchema.parse> & {
  email?: string | null;
};
type CustomerCreatePayload = Omit<CustomerPayload, 'id' | 'createdAt'>;
type CustomerUpdatePayload = Partial<CustomerCreatePayload>;

@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private inferNameParts(fullName?: string | null) {
    const normalizedFullName = normalizeTitle(fullName ?? undefined) ?? '';
    const parts = normalizedFullName.split(' ').filter(Boolean);
    return {
      fullName: normalizedFullName,
      firstName: parts[0] || null,
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : null
    };
  }

  private inferAddressLine1(address?: string | null) {
    const normalizedAddress = normalizeText(address ?? undefined) ?? '';
    if (!normalizedAddress) return null;

    const segments = normalizedAddress
      .split(',')
      .map((segment) => normalizeText(segment) || '')
      .filter(Boolean);
    if (segments.length === 0) return null;

    const numberSegment = segments[1] || '';
    const hasStreetNumber = /^(?:(?:n(?:[.o]|o|umero)?\s*)?\d+[a-z]?(?:[-/]\d+[a-z]?)?|s\/?n|sem numero)$/i.test(
      numberSegment
    );
    const inferred = hasStreetNumber ? `${segments[0]}, ${numberSegment}` : segments[0];
    return normalizeTitle(inferred ?? undefined);
  }

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
    const inferredName = this.inferNameParts(customer.name);
    const inferredAddressLine1 = this.inferAddressLine1(customer.address);

    return {
      ...customer,
      firstName: this.pickPromotedTitle(customer.firstName, inferredName.firstName) ?? inferredName.firstName,
      lastName: this.pickPromotedTitle(customer.lastName, inferredName.lastName) ?? inferredName.lastName,
      addressLine1:
        this.pickPromotedTitle(customer.addressLine1, inferredAddressLine1) ?? inferredAddressLine1
    };
  }

  list() {
    return this.prisma.customer
      .findMany({
      where: { deletedAt: null },
      orderBy: { id: 'desc' }
      })
      .then((customers) => customers.map((customer) => this.normalizeCustomerAutofillView(customer)));
  }

  async get(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente nao encontrado');
    return this.normalizeCustomerAutofillView(customer);
  }

  create(payload: unknown) {
    const data = CustomerSchema.omit({ id: true, createdAt: true }).parse(payload) as CustomerCreatePayload;
    const inferredName = this.inferNameParts(data.name);
    const fullName = inferredName.fullName || data.name;
    const firstName = this.pickPromotedTitle(data.firstName, inferredName.firstName) ?? inferredName.firstName;
    const lastName = this.pickPromotedTitle(data.lastName, inferredName.lastName) ?? inferredName.lastName;
    const normalizedPhone = normalizePhone(data.phone);
    const normalizedAddress = normalizeTitle(data.address ?? undefined);
    const inferredAddressLine1 = this.inferAddressLine1(normalizedAddress);
    const addressLine1 = this.pickPromotedTitle(data.addressLine1, inferredAddressLine1) ?? inferredAddressLine1;
    const normalizedAddressLine2 = normalizeTitle(data.addressLine2 ?? undefined);
    const normalizedNeighborhood = normalizeTitle(data.neighborhood ?? undefined);
    const normalizedCity = normalizeTitle(data.city ?? undefined);
    const normalizedState = normalizeText(data.state ?? undefined)?.toUpperCase() ?? null;
    const normalizedPostalCode = normalizeText(data.postalCode ?? undefined);
    const normalizedCountry = normalizeTitle(data.country ?? undefined);
    const normalizedEmail = normalizeText(data.email ?? undefined)?.toLowerCase() ?? null;
    const normalizedPlaceId = normalizeText(data.placeId ?? undefined);
    const normalizedDeliveryNotes = normalizeText(data.deliveryNotes ?? undefined);

    return this.prisma.$transaction(async (tx) => {
      const existingByPhone = normalizedPhone
        ? await tx.customer.findFirst({
            where: { deletedAt: null, phone: normalizedPhone },
            orderBy: { id: 'desc' }
          })
        : null;
      const existingByEmail = normalizedEmail
        ? await tx.customer.findFirst({
            where: { deletedAt: null, email: normalizedEmail },
            orderBy: { id: 'desc' }
          })
        : null;

      if (existingByPhone && existingByEmail && existingByPhone.id !== existingByEmail.id) {
        throw new BadRequestException(`Email ja vinculado ao cliente #${existingByEmail.id}.`);
      }

      const reusableCustomer = existingByPhone || existingByEmail;

      if (reusableCustomer) {
        return tx.customer.update({
          where: { id: reusableCustomer.id },
          data: {
            name: reusableCustomer.name || fullName,
            firstName: reusableCustomer.firstName || firstName,
            lastName: reusableCustomer.lastName || lastName,
            email: reusableCustomer.email || normalizedEmail,
            phone: reusableCustomer.phone || normalizedPhone,
            address: reusableCustomer.address || normalizedAddress,
            addressLine1: reusableCustomer.addressLine1 || addressLine1,
            addressLine2: reusableCustomer.addressLine2 || normalizedAddressLine2,
            neighborhood: reusableCustomer.neighborhood || normalizedNeighborhood,
            city: reusableCustomer.city || normalizedCity,
            state: reusableCustomer.state || normalizedState,
            postalCode: reusableCustomer.postalCode || normalizedPostalCode,
            country: reusableCustomer.country || normalizedCountry,
            placeId: reusableCustomer.placeId || normalizedPlaceId,
            lat: reusableCustomer.lat ?? data.lat ?? null,
            lng: reusableCustomer.lng ?? data.lng ?? null,
            deliveryNotes: reusableCustomer.deliveryNotes || normalizedDeliveryNotes
          }
        });
      }

      return tx.customer.create({
        data: {
          ...data,
          name: fullName,
          firstName,
          lastName,
          email: normalizedEmail,
          phone: normalizedPhone,
          address: normalizedAddress,
          addressLine1,
          addressLine2: normalizedAddressLine2,
          neighborhood: normalizedNeighborhood,
          city: normalizedCity,
          state: normalizedState,
          postalCode: normalizedPostalCode,
          country: normalizedCountry,
          placeId: normalizedPlaceId,
          lat: data.lat ?? null,
          lng: data.lng ?? null,
          deliveryNotes: normalizedDeliveryNotes
        }
      });
    });
  }

  async update(id: number, payload: unknown) {
    const existing = await this.get(id);
    const data = CustomerSchema.partial().omit({ id: true, createdAt: true }).parse(payload) as CustomerUpdatePayload;

    const nextName = data.name !== undefined ? normalizeTitle(data.name) ?? data.name : existing.name;
    const inferredName = this.inferNameParts(nextName);
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
    const inferredAddressLine1 = this.inferAddressLine1(nextAddress);
    const addressLine1 = shouldRecomputeAddressLine1
      ? this.pickPromotedTitle(
          data.addressLine1 !== undefined ? data.addressLine1 : existing.addressLine1,
          inferredAddressLine1
        )
      : undefined;
    const normalizedPhone = data.phone !== undefined ? normalizePhone(data.phone) : undefined;
    const normalizedEmail =
      data.email !== undefined ? normalizeText(data.email ?? undefined)?.toLowerCase() ?? null : undefined;

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
        throw new BadRequestException(`Telefone ja vinculado ao cliente #${conflict.id}.`);
      }
    }

    if (normalizedEmail) {
      const conflict = await this.prisma.customer.findFirst({
        where: {
          deletedAt: null,
          email: normalizedEmail,
          id: { not: id }
        },
        orderBy: { id: 'desc' }
      });
      if (conflict) {
        throw new BadRequestException(`Email ja vinculado ao cliente #${conflict.id}.`);
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: {
        ...data,
        name: data.name ? normalizeTitle(data.name) ?? data.name : undefined,
        firstName,
        lastName,
        email: normalizedEmail,
        phone: normalizedPhone,
        address: data.address !== undefined ? normalizeTitle(data.address) ?? null : undefined,
        addressLine1,
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
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente nao encontrado');
    if (customer.deletedAt) {
      return;
    }
    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }
}
