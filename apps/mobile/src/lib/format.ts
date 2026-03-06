import { formatPhoneNumber as formatPhoneNumberIntl, normalizePhoneNumber } from '@querobroapp/shared';

export function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function titleCase(value: string) {
  return compactWhitespace(value)
    .toLowerCase()
    .replace(/(^|[\s,.-])([a-zà-ú])/g, (match) => match.toUpperCase());
}

export function normalizePhone(value?: string | null) {
  return normalizePhoneNumber(value);
}

export function formatPhoneBR(value?: string | null) {
  return formatPhoneNumberIntl(value);
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
