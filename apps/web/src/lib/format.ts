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

export function parseLocaleNumber(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  let normalized = raw.replace(/\s+/g, '').replace(/^R\$\s*/i, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = normalized.replace(/,/g, '.');
  } else if (hasDot) {
    const dotCount = (normalized.match(/\./g) || []).length;
    if (dotCount > 1) {
      normalized = normalized.replace(/\./g, '');
    } else {
      const parts = normalized.split('.');
      const decimalPart = parts[1] || '';
      if (/^\d{3}$/.test(decimalPart)) {
        normalized = normalized.replace('.', '');
      }
    }
  }

  normalized = normalized.replace(/[^0-9.+-]/g, '');
  if (!normalized || normalized === '+' || normalized === '-' || normalized === '.') {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCurrencyBR(value: string) {
  return parseLocaleNumber(value) ?? 0;
}

export function normalizeAddress(value?: string | null) {
  if (!value) return null;
  return titleCase(value);
}
