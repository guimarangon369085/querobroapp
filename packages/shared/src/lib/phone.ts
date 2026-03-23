import { AsYouType, CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

const onlyDigits = (value: string) => value.replace(/\D/g, '');
const PHONE_DIGITS_MAX = 15;
const DEFAULT_PHONE_COUNTRY: CountryCode = 'BR';

export function normalizePhoneNumber(
  value?: string | null,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY
) {
  if (!value) return null;
  const rawDigits = onlyDigits(value);
  if (!rawDigits) return null;
  let normalized = rawDigits.slice(0, PHONE_DIGITS_MAX);

  try {
    const parsed = parsePhoneNumberFromString(value, defaultCountry);
    if (parsed) {
      const formatted = parsed.number;
      if (typeof formatted === 'string' && formatted.length > 0) {
        normalized = formatted.replace(/\D/g, '').slice(0, PHONE_DIGITS_MAX);
      }
    }
  } catch {
    // ignore parse failures and fallback to digit-based normalization
  }

  return normalized.length ? normalized : null;
}

export function formatPhoneNumber(value?: string | null, defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY) {
  if (!value) return '';
  const formatter = new AsYouType(defaultCountry);
  return formatter.input(value).trim();
}
