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
