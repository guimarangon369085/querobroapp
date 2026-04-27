import { normalizeText, normalizeTitle } from './normalize.js';

export type CustomerAddressPayload = {
  address?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  deliveryNotes?: string | null;
};

export type NormalizedCustomerAddressPayload = {
  address: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  deliveryNotes: string | null;
};

export function inferCustomerNameParts(fullName?: string | null) {
  const normalizedFullName = normalizeTitle(fullName ?? undefined) ?? '';
  const parts = normalizedFullName.split(' ').filter(Boolean);
  return {
    fullName: normalizedFullName,
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null
  };
}

export function inferAddressLine1(address?: string | null) {
  const normalizedAddress = normalizeText(address ?? undefined) ?? '';
  if (!normalizedAddress) return null;

  const segments = normalizedAddress
    .split(',')
    .map((segment) => normalizeText(segment) || '')
    .filter(Boolean);
  if (segments.length === 0) return null;

  const numberSegment = segments[1] || '';
  const hasStreetNumber = /^(?:(?:n(?:[.o]|o|umero)?\s*)?\d+[a-z]?(?:[-/]\d+[a-z]?)?|s\/?n|sem numero)$/i.test(
    numberSegment
  );
  const inferred = hasStreetNumber ? `${segments[0]}, ${numberSegment}` : segments[0];
  return normalizeTitle(inferred ?? undefined);
}

export function normalizeNeighborhood(value?: string | null) {
  const normalized = normalizeTitle(value ?? undefined);
  if (!normalized) return null;
  return /\d/.test(normalized) ? null : normalized;
}

export function buildCustomerAddressSummary(value: CustomerAddressPayload) {
  const cityState = [normalizeTitle(value.city ?? undefined), normalizeText(value.state ?? undefined)?.toUpperCase()]
    .filter(Boolean)
    .join(' - ');
  const parts = [
    normalizeTitle(value.addressLine1 ?? undefined),
    normalizeTitle(value.addressLine2 ?? undefined),
    normalizeNeighborhood(value.neighborhood ?? undefined),
    cityState || null,
    normalizeText(value.postalCode ?? undefined),
    normalizeTitle(value.country ?? undefined)
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

export function normalizeCustomerAddressPayload(input: CustomerAddressPayload): NormalizedCustomerAddressPayload {
  const normalizedAddress = normalizeTitle(input.address ?? undefined) ?? null;
  const inferredAddressLine1 = inferAddressLine1(normalizedAddress);
  const addressLine1 = normalizeTitle(input.addressLine1 ?? undefined) ?? inferredAddressLine1 ?? null;
  const addressLine2 = normalizeTitle(input.addressLine2 ?? undefined) ?? null;
  const neighborhood = normalizeNeighborhood(input.neighborhood ?? undefined);
  const city = normalizeTitle(input.city ?? undefined) ?? null;
  const state = normalizeText(input.state ?? undefined)?.toUpperCase() ?? null;
  const postalCode = normalizeText(input.postalCode ?? undefined) ?? null;
  const country = normalizeTitle(input.country ?? undefined) ?? null;
  const placeId = normalizeText(input.placeId ?? undefined) ?? null;
  const deliveryNotes = normalizeText(input.deliveryNotes ?? undefined) ?? null;
  const lat = typeof input.lat === 'number' && Number.isFinite(input.lat) ? input.lat : null;
  const lng = typeof input.lng === 'number' && Number.isFinite(input.lng) ? input.lng : null;
  const summary = buildCustomerAddressSummary({
    addressLine1,
    addressLine2,
    neighborhood,
    city,
    state,
    postalCode,
    country
  });

  return {
    address: normalizedAddress || summary || null,
    addressLine1,
    addressLine2,
    neighborhood,
    city,
    state,
    postalCode,
    country,
    placeId,
    lat,
    lng,
    deliveryNotes
  };
}

export function customerAddressIdentityKey(input: CustomerAddressPayload) {
  const normalized = normalizeCustomerAddressPayload(input);
  const structured = [
    normalized.addressLine1,
    normalized.addressLine2,
    normalized.neighborhood,
    normalized.city,
    normalized.state,
    normalized.postalCode,
    normalized.country,
    normalized.placeId,
    normalized.deliveryNotes
  ]
    .map((value) => normalizeText(value ?? undefined) ?? '')
    .join('|');
  if (structured.replace(/\|/g, '').trim()) {
    return structured.toLowerCase();
  }
  return (normalizeText(normalized.address ?? undefined) ?? '').toLowerCase();
}
