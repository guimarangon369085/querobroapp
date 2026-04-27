import { moneyFromMinorUnits, moneyToMinorUnits, roundMoney, subtractMoney } from './money.js';

// SumUp online checkout/link de pagamento currently uses the same online card rate table.
// The public app exposes a single "CARTAO" option with no installment selector, so we
// model the surcharge with the current card-at-sight rate.
export const SUMUP_CARD_SINGLE_PAYMENT_RATE = 0.0599;

export function computeGrossUpAmountFromRate(
  netAmount: number | null | undefined,
  rate: number | null | undefined
) {
  const normalizedNetAmount = roundMoney(netAmount);
  const normalizedRate = Number(rate ?? 0);

  if (moneyToMinorUnits(normalizedNetAmount) <= 0) return 0;
  if (!Number.isFinite(normalizedRate) || normalizedRate <= 0 || normalizedRate >= 1) {
    return normalizedNetAmount;
  }

  const grossMinorUnits = Math.ceil(moneyToMinorUnits(normalizedNetAmount) / (1 - normalizedRate));
  return moneyFromMinorUnits(grossMinorUnits);
}

export function computeGrossUpFeeAmountFromRate(
  netAmount: number | null | undefined,
  rate: number | null | undefined
) {
  const grossAmount = computeGrossUpAmountFromRate(netAmount, rate);
  return subtractMoney(grossAmount, netAmount);
}

export function computeSumUpCardPayableTotal(netAmount: number | null | undefined) {
  return computeGrossUpAmountFromRate(netAmount, SUMUP_CARD_SINGLE_PAYMENT_RATE);
}

export function computeSumUpCardSurchargeAmount(netAmount: number | null | undefined) {
  return computeGrossUpFeeAmountFromRate(netAmount, SUMUP_CARD_SINGLE_PAYMENT_RATE);
}
