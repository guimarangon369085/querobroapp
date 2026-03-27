import { APPLIED_COUPON_NOTE_PREFIX, mergeAppliedCouponIntoNotes } from '@querobroapp/shared';
import { normalizeText } from './normalize.js';

export { APPLIED_COUPON_NOTE_PREFIX, mergeAppliedCouponIntoNotes };

export function normalizeCouponCode(value?: string | null) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}
