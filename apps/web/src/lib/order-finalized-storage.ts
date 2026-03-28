import type { OrderIntakeMeta } from '@querobroapp/shared';

export const ORDER_FINALIZED_STORAGE_KEY = 'querobroapp:order-finalized';

export type StoredOrderFinalized = {
  version: 1;
  origin: 'PUBLIC_FORM' | 'INTERNAL_DASHBOARD';
  savedAt: string;
  returnPath: '/pedido' | '/pedidos';
  returnLabel: string;
  productSubtotal: number;
  order: {
    id: number;
    publicNumber?: number | null;
    total?: number | null;
    scheduledAt?: string | null;
    deliveryWindowLabel?: string | null;
  };
  intake: Pick<OrderIntakeMeta, 'stage' | 'deliveryFee' | 'pixCharge'>;
};

function readStorageValue(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export function writeStoredOrderFinalized(payload: StoredOrderFinalized) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ORDER_FINALIZED_STORAGE_KEY, JSON.stringify(payload));
}

export function readStoredOrderFinalized(): StoredOrderFinalized | null {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = readStorageValue(window.sessionStorage, ORDER_FINALIZED_STORAGE_KEY);
    if (!parsed || parsed.version !== 1) return null;
    if (typeof parsed.productSubtotal !== 'number' || !Number.isFinite(parsed.productSubtotal)) return null;
    if (!parsed.order || typeof parsed.order !== 'object') return null;
    if (!parsed.intake || typeof parsed.intake !== 'object') return null;

    return {
      version: 1,
      origin: parsed.origin === 'INTERNAL_DASHBOARD' ? 'INTERNAL_DASHBOARD' : 'PUBLIC_FORM',
      savedAt: String(parsed.savedAt || '').trim(),
      returnPath: parsed.returnPath === '/pedidos' ? '/pedidos' : '/pedido',
      returnLabel:
        parsed.returnPath === '/pedidos'
          ? String(parsed.returnLabel || '').trim() || 'Voltar para pedidos'
          : String(parsed.returnLabel || '').trim() || 'Fazer novo pedido',
      productSubtotal: parsed.productSubtotal,
      order: parsed.order as StoredOrderFinalized['order'],
      intake: parsed.intake as StoredOrderFinalized['intake']
    };
  } catch {
    return null;
  }
}

export function clearStoredOrderFinalized() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(ORDER_FINALIZED_STORAGE_KEY);
}
