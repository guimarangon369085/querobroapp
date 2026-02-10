const PHONE_DIGITS_MAX = 11;

const onlyDigits = (value: string) => value.replace(/\D/g, '');

export function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function titleCase(value: string) {
  return compactWhitespace(value)
    .toLowerCase()
    .replace(/(^|[\s,.-])([a-zà-ú])/g, (match) => match.toUpperCase());
}

export function normalizePhone(value?: string | null) {
  if (!value) return null;
  const digits = onlyDigits(value).slice(0, PHONE_DIGITS_MAX);
  return digits.length ? digits : null;
}

export function formatPhoneBR(value?: string | null) {
  const digits = onlyDigits(value || '').slice(0, PHONE_DIGITS_MAX);
  if (!digits) return '';
  if (digits.length <= 10) {
    const ddd = digits.slice(0, 2);
    const part1 = digits.slice(2, 6);
    const part2 = digits.slice(6, 10);
    if (digits.length <= 2) return `(${ddd}`;
    if (digits.length <= 6) return `(${ddd}) ${part1}`;
    return `(${ddd}) ${part1}-${part2}`.trim();
  }
  const ddd = digits.slice(0, 2);
  const part1 = digits.slice(2, 7);
  const part2 = digits.slice(7, 11);
  if (digits.length <= 2) return `(${ddd}`;
  if (digits.length <= 7) return `(${ddd}) ${part1}`;
  return `(${ddd}) ${part1}-${part2}`.trim();
}

export function formatCurrencyBR(value?: number | null) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseCurrencyBR(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeAddress(value?: string | null) {
  if (!value) return null;
  return titleCase(value);
}
