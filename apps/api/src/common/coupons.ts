import type { Prisma, PrismaClient } from '@prisma/client';
import { APPLIED_COUPON_NOTE_PREFIX, mergeAppliedCouponIntoNotes } from '@querobroapp/shared';
import { normalizePhone, normalizeText } from './normalize.js';

export { APPLIED_COUPON_NOTE_PREFIX, mergeAppliedCouponIntoNotes };

export function normalizeCouponCode(value?: string | null) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

export function parseAppliedCouponFromNotes(notes?: string | null) {
  const lines = String(notes || '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const line = lines.find((entry) => entry.startsWith(APPLIED_COUPON_NOTE_PREFIX));
  if (!line) return null;

  const rawValue = line.slice(APPLIED_COUPON_NOTE_PREFIX.length).trim();
  if (!rawValue) return null;

  const discountMatch = rawValue.match(/\(([\d.,]+)%\)\s*$/);
  const code = normalizeCouponCode(
    discountMatch ? rawValue.slice(0, discountMatch.index).trim() : rawValue
  );
  if (!code) return null;

  const normalizedPct = discountMatch?.[1]?.replace(/\./g, '').replace(',', '.') || '';
  const parsedDiscountPct = Number.parseFloat(normalizedPct);

  return {
    code,
    discountPct: Number.isFinite(parsedDiscountPct) ? parsedDiscountPct : null
  };
}

export function resolveStoredCouponCode(couponCode?: string | null, notes?: string | null) {
  return normalizeCouponCode(couponCode) || parseAppliedCouponFromNotes(notes)?.code || null;
}

type CouponUsageClient = Pick<PrismaClient, 'customer' | 'order'> | Prisma.TransactionClient;

export async function countCouponUsageForCustomer(
  client: CouponUsageClient,
  params: {
    couponCode?: string | null;
    customerId?: number | null;
    customerPhone?: string | null;
  }
) {
  const normalizedCode = normalizeCouponCode(params.couponCode);
  if (!normalizedCode) return 0;

  let customerIds: number[] = [];
  if (typeof params.customerId === 'number' && Number.isInteger(params.customerId) && params.customerId > 0) {
    customerIds = [params.customerId];
  } else {
    const normalizedPhone = normalizePhone(params.customerPhone);
    if (!normalizedPhone) return 0;
    const matchedCustomers = await client.customer.findMany({
      where: {
        deletedAt: null,
        phone: normalizedPhone
      },
      select: {
        id: true
      }
    });
    customerIds = matchedCustomers
      .map((entry) => entry.id)
      .filter((value, index, collection) => collection.indexOf(value) === index);
  }

  if (!customerIds.length) return 0;

  const orders = await client.order.findMany({
    where: {
      customerId: { in: customerIds },
      status: { not: 'CANCELADO' }
    },
    select: {
      couponCode: true,
      notes: true
    }
  });

  return orders.reduce((sum, order) => {
    return resolveStoredCouponCode(order.couponCode, order.notes) === normalizedCode ? sum + 1 : sum;
  }, 0);
}
