import { normalizeText } from './normalize.js';

export const APPLIED_COUPON_NOTE_PREFIX = 'Cupom aplicado:';

export function normalizeCouponCode(value?: string | null) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

export function mergeAppliedCouponIntoNotes(
  currentNotes: string | null | undefined,
  appliedCoupon: { code: string; discountPct: number } | null
) {
  const preservedLines = String(currentNotes || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith(APPLIED_COUPON_NOTE_PREFIX));

  if (!appliedCoupon) return preservedLines.join('\n') || null;

  preservedLines.push(
    `${APPLIED_COUPON_NOTE_PREFIX} ${appliedCoupon.code} (${Number(appliedCoupon.discountPct).toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}%)`
  );

  return preservedLines.join('\n');
}
