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

function useOperationFlowState(options: UseOperationFlowOptions = {}): UseOperationFlowResult {
  const refreshIntervalMs = options.refreshIntervalMs ?? 0;
  const enabled = options.enabled ?? true;
  const [raw, setRaw] = useState<OperationFlowRaw>(EMPTY_FLOW_RAW);
  const [mode, setMode] = useState<FlowConnectionMode>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!mountedRef.current) return;
    setRefreshing(true);
    setError(null);

    try {
      const [products, customers, orders, payments, boms] = await Promise.all([
        apiFetch<Product[]>('/products'),
        apiFetch<Customer[]>('/customers'),
        apiFetch<Order[]>('/orders'),
        apiFetch<Payment[]>('/payments'),
        apiFetch<Bom[]>('/boms')
      ]);

      if (!mountedRef.current) return;
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

  useEffect(() => {
    if (!enabled) return;
    refresh().catch(() => {
      // erro tratado em refresh
    });
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return;
    const timer = window.setInterval(() => {
      refresh().catch(() => {
        // erro tratado em refresh
      });
    }, refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, refresh, refreshIntervalMs]);

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
