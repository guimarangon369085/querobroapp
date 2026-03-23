export function moneyToMinorUnits(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100);
}

export function moneyFromMinorUnits(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed) / 100;
}

export function roundMoney(value: number | null | undefined) {
  return moneyFromMinorUnits(moneyToMinorUnits(value));
}

export function sumMoney(values: Array<number | null | undefined>) {
  return moneyFromMinorUnits(
    values.reduce<number>((sum, value) => sum + moneyToMinorUnits(value), 0)
  );
}

export function subtractMoney(
  base: number | null | undefined,
  ...values: Array<number | null | undefined>
) {
  const totalMinorUnits = values.reduce<number>((sum, value) => sum + moneyToMinorUnits(value), 0);
  return moneyFromMinorUnits(moneyToMinorUnits(base) - totalMinorUnits);
}

export function multiplyMoney(value: number | null | undefined, factor: number | null | undefined) {
  const parsedFactor = Number(factor ?? 0);
  if (!Number.isFinite(parsedFactor)) return 0;
  return moneyFromMinorUnits(Math.round(moneyToMinorUnits(value) * parsedFactor));
}

export function compareMoney(left: number | null | undefined, right: number | null | undefined) {
  return moneyToMinorUnits(left) - moneyToMinorUnits(right);
}
