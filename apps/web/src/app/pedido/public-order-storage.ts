import type { OrderIntakeMeta } from '@querobroapp/shared';

export const PUBLIC_ORDER_DRAFT_SESSION_STORAGE_KEY = 'querobroapp:public-order-draft-session-id';
export const PUBLIC_ORDER_PROFILE_STORAGE_KEY = 'querobroapp:public-order-profile';
export const PUBLIC_ORDER_LAST_ORDER_STORAGE_KEY = 'querobroapp:public-order-last-order';
export const PUBLIC_ORDER_PICKUP_ADDRESS = 'Alameda Jaú, 731';

export type PublicOrderResult = {
  order: {
    id: number;
    publicNumber?: number | null;
    total?: number;
    scheduledAt?: string | null;
    deliveryWindowLabel?: string | null;
  };
  intake: OrderIntakeMeta;
};

export type StoredPublicOrderProfile = {
  version: 1;
  name: string;
  phone: string;
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  address: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  deliveryNotes: string;
};

function readStorageValue(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export function readStoredPublicOrderProfile(): StoredPublicOrderProfile | null {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = readStorageValue(window.localStorage, PUBLIC_ORDER_PROFILE_STORAGE_KEY);
    if (!parsed || parsed.version !== 1) return null;

    const fulfillmentMode = parsed.fulfillmentMode === 'PICKUP' ? 'PICKUP' : 'DELIVERY';

    return {
      version: 1,
      name: String(parsed.name || '').trim(),
      phone: String(parsed.phone || '').trim(),
      fulfillmentMode,
      address:
        fulfillmentMode === 'PICKUP'
          ? PUBLIC_ORDER_PICKUP_ADDRESS
          : String(parsed.address || '').trim(),
      placeId: fulfillmentMode === 'DELIVERY' ? String(parsed.placeId || '').trim() : '',
      lat: typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) ? parsed.lat : null,
      lng: typeof parsed.lng === 'number' && Number.isFinite(parsed.lng) ? parsed.lng : null,
      deliveryNotes: String(parsed.deliveryNotes || '').trim()
    };
  } catch {
    return null;
  }
}
