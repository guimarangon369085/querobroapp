const onlyDigits = (value: string) => value.replace(/\D/g, '');

export function normalizePhone(value?: string | null) {
  if (!value) return null;
  const digits = onlyDigits(value).slice(0, 11);
  return digits.length ? digits : null;
}

export function normalizeText(value?: string | null) {
  if (!value) return null;
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(value?: string | null) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized
    .toLowerCase()
    .replace(/(^|[\s,.-])([a-zà-ú])/g, (match) => match.toUpperCase());
}

export function normalizeMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
