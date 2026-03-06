import type { Customer } from '@querobroapp/shared';
import { compactWhitespace, formatPostalCodeBR, titleCase } from './format';

export type CustomerAutofillPatch = Partial<
  Pick<
    Customer,
    | 'address'
    | 'addressLine1'
    | 'addressLine2'
    | 'city'
    | 'country'
    | 'firstName'
    | 'lastName'
    | 'neighborhood'
    | 'postalCode'
    | 'state'
  >
>;

const POSTAL_CODE_PATTERN = /\b\d{5}-?\d{3}\b/;
const STATE_PATTERN = /^[A-Za-z]{2}$/;
const CITY_AND_STATE_PATTERN = /^(.*?)(?:\s*[-/]\s*|\s+)([A-Za-z]{2})$/;
const STREET_NUMBER_PATTERN = /^(?:(?:n(?:[.o]|o|umero)?\s*)?\d+[a-z]?(?:[-/]\d+[a-z]?)?|s\/?n|sem numero)$/i;
const COMPLEMENT_PATTERN =
  /\b(ap(?:to)?\.?|apart(?:amento)?|bloco|casa|cj|conj(?:unto)?|cobertura|ed(?:ificio)?|fundos|kitnet|loja|lote|qd|quadra|sala|sobrado|torre|andar)\b/i;

type ViaCepResponse = {
  bairro?: string;
  cep?: string;
  complemento?: string;
  erro?: boolean;
  localidade?: string;
  logradouro?: string;
  uf?: string;
};

function normalizeSegment(value?: string | null) {
  const normalized = compactWhitespace(value || '');
  if (!normalized) return '';
  return titleCase(normalized);
}

function looksLikeComplement(value?: string | null) {
  const normalized = compactWhitespace(value || '');
  if (!normalized) return false;
  return COMPLEMENT_PATTERN.test(normalized);
}

export function buildCustomerNameAutofill(name?: string | null): CustomerAutofillPatch {
  const parts = compactWhitespace(name || '')
    .split(' ')
    .filter(Boolean);

  return {
    firstName: parts[0] ? titleCase(parts[0]) : '',
    lastName: parts.length > 1 ? titleCase(parts.slice(1).join(' ')) : ''
  };
}

export function buildCustomerAddressAutofill(address?: string | null): CustomerAutofillPatch {
  const normalized = compactWhitespace(address || '');
  const fallback: CustomerAutofillPatch = {
    addressLine1: '',
    addressLine2: '',
    neighborhood: '',
    city: '',
    state: '',
    postalCode: ''
  };

  if (!normalized) return fallback;

  const postalCodeMatch = normalized.match(POSTAL_CODE_PATTERN);
  const postalCode = postalCodeMatch ? formatPostalCodeBR(postalCodeMatch[0]) : '';
  const working = postalCodeMatch
    ? compactWhitespace(normalized.replace(postalCodeMatch[0], '').replace(/\s*,\s*$/, ''))
    : normalized;
  const segments = working
    .split(',')
    .map((segment) => compactWhitespace(segment))
    .filter(Boolean);

  const normalizedSegments =
    segments.length > 1 && STREET_NUMBER_PATTERN.test(segments[1] || '')
      ? [`${segments[0]}, ${segments[1]}`, ...segments.slice(2)]
      : segments;

  if (normalizedSegments.length === 0) {
    return {
      ...fallback,
      postalCode
    };
  }

  const addressLine1 = normalizeSegment(normalizedSegments[0]);
  const lastSegment = normalizedSegments[normalizedSegments.length - 1] || '';
  let city = '';
  let state = '';
  let cityIndex = -1;

  if (normalizedSegments.length > 1) {
    if (STATE_PATTERN.test(lastSegment)) {
      state = lastSegment.toUpperCase();
      cityIndex = normalizedSegments.length - 2;
      city = cityIndex >= 1 ? normalizeSegment(normalizedSegments[cityIndex]) : '';
    } else {
      const combined = lastSegment.match(CITY_AND_STATE_PATTERN);
      if (combined && STATE_PATTERN.test(combined[2] || '')) {
        city = normalizeSegment(combined[1]);
        state = combined[2].toUpperCase();
        cityIndex = normalizedSegments.length - 1;
      } else if (!looksLikeComplement(lastSegment)) {
        city = normalizeSegment(lastSegment);
        cityIndex = normalizedSegments.length - 1;
      }
    }
  }

  let neighborhood = '';
  let neighborhoodIndex = -1;
  if (cityIndex > 1) {
    const candidate = normalizedSegments[cityIndex - 1];
    if (!looksLikeComplement(candidate)) {
      neighborhood = normalizeSegment(candidate);
      neighborhoodIndex = cityIndex - 1;
    }
  }

  const complementEnd =
    neighborhoodIndex >= 0 ? neighborhoodIndex : cityIndex > 0 ? cityIndex : normalizedSegments.length;
  const addressLine2 = normalizeSegment(
    normalizedSegments.slice(1, Math.max(1, complementEnd)).join(', ')
  );

  return {
    addressLine1,
    addressLine2,
    neighborhood,
    city,
    state,
    postalCode
  };
}

export function buildCustomerAddressSummary(values: CustomerAutofillPatch) {
  const addressLine1 = compactWhitespace(values.addressLine1 || '');
  const addressLine2 = compactWhitespace(values.addressLine2 || '');
  const neighborhood = compactWhitespace(values.neighborhood || '');
  const city = compactWhitespace(values.city || '');
  const state = compactWhitespace(values.state || '').toUpperCase();
  const postalCode = formatPostalCodeBR(values.postalCode || '');

  const cityAndState = city && state ? `${city} - ${state}` : city || state;

  return [addressLine1, addressLine2, neighborhood, cityAndState, postalCode]
    .filter(Boolean)
    .join(', ');
}

export async function lookupPostalCodeAutofill(
  postalCode: string,
  options?: { signal?: AbortSignal }
): Promise<CustomerAutofillPatch | null> {
  const digits = postalCode.replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return null;

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
    headers: {
      Accept: 'application/json'
    },
    signal: options?.signal
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as ViaCepResponse;
  if (payload.erro) return null;

  const patch: CustomerAutofillPatch = {
    addressLine1: normalizeSegment(payload.logradouro),
    neighborhood: normalizeSegment(payload.bairro),
    city: normalizeSegment(payload.localidade),
    state: payload.uf ? payload.uf.toUpperCase() : '',
    postalCode: formatPostalCodeBR(payload.cep || digits),
    country: 'Brasil'
  };

  if (payload.complemento) {
    patch.addressLine2 = normalizeSegment(payload.complemento);
  }

  const address = buildCustomerAddressSummary(patch);
  if (address) {
    patch.address = address;
  }

  return patch;
}
