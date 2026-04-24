import type { OrderIntakeMeta } from '@querobroapp/shared';

export const PUBLIC_ORDER_DRAFT_SESSION_STORAGE_KEY = 'querobroapp:public-order-draft-session-id';
export const PUBLIC_ORDER_PROFILE_STORAGE_KEY = 'querobroapp:public-order-profile';
export const PUBLIC_ORDER_LAST_ORDER_STORAGE_KEY = 'querobroapp:public-order-last-order';
export const PUBLIC_ORDER_PICKUP_ADDRESS = 'Alameda Jaú, 731';

export type PublicOrderResult = {
  order: {
    total?: number;
    scheduledAt?: string | null;
    deliveryWindowLabel?: string | null;
  };
  intake: Pick<OrderIntakeMeta, 'stage' | 'deliveryFee' | 'paymentMethod' | 'pixCharge' | 'cardCheckout'>;
};

export type StoredPublicOrderProfile = {
  version: 1 | 2 | 3;
  name: string;
  phone: string;
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  address: string;
  addressLine1: string;
  addressLine2: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
};

function readStorageValue(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export function readStoredPublicOrderProfile(): StoredPublicOrderProfile | null {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = readStorageValue(window.localStorage, PUBLIC_ORDER_PROFILE_STORAGE_KEY);
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)) return null;

    const fulfillmentMode = parsed.fulfillmentMode === 'PICKUP' ? 'PICKUP' : 'DELIVERY';

    return {
      version: 2,
      name: String(parsed.name || '').trim(),
      phone: String(parsed.phone || '').trim(),
      fulfillmentMode,
      address:
        fulfillmentMode === 'PICKUP'
          ? PUBLIC_ORDER_PICKUP_ADDRESS
          : String(parsed.address || '').trim(),
      addressLine1: fulfillmentMode === 'DELIVERY' ? String(parsed.addressLine1 || '').trim() : '',
      addressLine2: String(parsed.addressLine2 || parsed.deliveryNotes || '').trim(),
      neighborhood: fulfillmentMode === 'DELIVERY' ? String(parsed.neighborhood || '').trim() : '',
      city: fulfillmentMode === 'DELIVERY' ? String(parsed.city || '').trim() : '',
      state: fulfillmentMode === 'DELIVERY' ? String(parsed.state || '').trim() : '',
      postalCode: fulfillmentMode === 'DELIVERY' ? String(parsed.postalCode || '').trim() : '',
      country: fulfillmentMode === 'DELIVERY' ? String(parsed.country || '').trim() : '',
      placeId: fulfillmentMode === 'DELIVERY' ? String(parsed.placeId || '').trim() : '',
      lat: typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) ? parsed.lat : null,
      lng: typeof parsed.lng === 'number' && Number.isFinite(parsed.lng) ? parsed.lng : null
    };
  } catch {
    return null;
  }
}
