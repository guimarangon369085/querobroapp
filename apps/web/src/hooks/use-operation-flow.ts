'use client';

import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { Bom, Customer, Order, Payment, Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import {
  deriveOperationFlow,
  EMPTY_FLOW_RAW,
  resolveFlowFallback,
  type FlowConnectionMode,
  type OperationFlow,
  type OperationFlowRaw
} from '@/lib/operation-flow';

type UseOperationFlowOptions = {
  refreshIntervalMs?: number;
  enabled?: boolean;
};

type UseOperationFlowResult = {
  raw: OperationFlowRaw;
  flow: OperationFlow;
  mode: FlowConnectionMode;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
};

const OperationFlowContext = createContext<UseOperationFlowResult | null>(null);
const OPERATION_FLOW_CUSTOMERS_REFRESH_MS = 2 * 60 * 1000;
const OPERATION_FLOW_CATALOG_REFRESH_MS = 5 * 60 * 1000;

function useOperationFlowState(options: UseOperationFlowOptions = {}): UseOperationFlowResult {
  const refreshIntervalMs = options.refreshIntervalMs ?? 0;
  const enabled = options.enabled ?? true;
  const [raw, setRaw] = useState<OperationFlowRaw>(EMPTY_FLOW_RAW);
  const [mode, setMode] = useState<FlowConnectionMode>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const rawRef = useRef<OperationFlowRaw>(EMPTY_FLOW_RAW);
  const lastCustomersRefreshAtRef = useRef(0);
  const lastCatalogRefreshAtRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    rawRef.current = raw;
  }, [raw]);

  const loadFlowData = useCallback(async (strategy: 'full' | 'poll') => {
    if (!enabled) return;
    if (!mountedRef.current) return;
    setRefreshing(true);
    setError(null);

    try {
      const now = Date.now();
      const current = rawRef.current;
      const shouldRefreshCustomers =
        strategy === 'full' ||
        current.customers.length === 0 ||
        now - lastCustomersRefreshAtRef.current >= OPERATION_FLOW_CUSTOMERS_REFRESH_MS;
      const shouldRefreshCatalog =
        strategy === 'full' ||
        current.products.length === 0 ||
        current.boms.length === 0 ||
        now - lastCatalogRefreshAtRef.current >= OPERATION_FLOW_CATALOG_REFRESH_MS;

      const [products, customers, orders, payments, boms] = await Promise.all([
        shouldRefreshCatalog
          ? apiFetch<Product[]>('/inventory-products')
          : Promise.resolve(current.products),
        shouldRefreshCustomers ? apiFetch<Customer[]>('/customers') : Promise.resolve(current.customers),
        apiFetch<Order[]>('/orders'),
        apiFetch<Payment[]>('/payments'),
        shouldRefreshCatalog ? apiFetch<Bom[]>('/boms') : Promise.resolve(current.boms)
      ]);

      if (!mountedRef.current) return;
      if (shouldRefreshCustomers) {
        lastCustomersRefreshAtRef.current = now;
      }
      if (shouldRefreshCatalog) {
        lastCatalogRefreshAtRef.current = now;
      }
      setRaw({ products, customers, orders, payments, boms });
      setMode('online');
    } catch (loadError) {
      if (!mountedRef.current) return;
      setRaw((previous) => resolveFlowFallback(previous));
      setMode('offline');
      setError(loadError instanceof Error ? loadError.message : 'Falha de conexao com a API');
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [enabled]);

  const refresh = useCallback(async () => {
    await loadFlowData('full');
  }, [loadFlowData]);

  useEffect(() => {
    if (!enabled) return;
    loadFlowData('full').catch(() => {
      // erro tratado em refresh
    });
  }, [enabled, loadFlowData]);

  useEffect(() => {
    if (!enabled) return;
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return;
    const timer = window.setInterval(() => {
      loadFlowData('poll').catch(() => {
        // erro tratado em refresh
      });
    }, refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, loadFlowData, refreshIntervalMs]);

  const flow = useMemo(() => deriveOperationFlow(raw), [raw]);

  return { raw, flow, mode, error, refreshing, refresh };
}

type OperationFlowProviderProps = {
  children: ReactNode;
  refreshIntervalMs?: number;
};

export function OperationFlowProvider({
  children,
  refreshIntervalMs = 30000
}: OperationFlowProviderProps) {
  const value = useOperationFlowState({ refreshIntervalMs, enabled: true });
  return createElement(OperationFlowContext.Provider, { value }, children);
}

export function useOperationFlow(options: UseOperationFlowOptions = {}): UseOperationFlowResult {
  const context = useContext(OperationFlowContext);
  const local = useOperationFlowState({ ...options, enabled: !context });
  return context ?? local;
}
