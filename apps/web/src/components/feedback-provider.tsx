'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

type ToastType = 'success' | 'error' | 'info';

type ToastInput = {
  type: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
};

type ToastItem = ToastInput & {
  id: string;
};

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmState = {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

type FeedbackContextValue = {
  notify: (input: ToastInput) => void;
  notifySuccess: (message: string, title?: string) => void;
  notifyError: (message: string, title?: string) => void;
  notifyInfo: (message: string, title?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const toastTypeMeta: Record<ToastType, { title: string; className: string }> = {
  success: { title: 'Sucesso', className: 'app-toast--success' },
  error: { title: 'Erro', className: 'app-toast--error' },
  info: { title: 'Aviso', className: 'app-toast--info' }
};

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const pendingConfirmRef = useRef<ConfirmState | null>(null);

  useEffect(() => {
    pendingConfirmRef.current = confirmState;
  }, [confirmState]);

  useEffect(() => {
    return () => {
      pendingConfirmRef.current?.resolve(false);
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (input: ToastInput) => {
      const id = randomId();
      const nextToast: ToastItem = {
        id,
        durationMs: 3800,
        ...input
      };
      setToasts((prev) => [nextToast, ...prev].slice(0, 5));

      const duration = Math.max(1200, nextToast.durationMs || 3800);
      window.setTimeout(() => removeToast(id), duration);
    },
    [removeToast]
  );

  const notifySuccess = useCallback(
    (message: string, title?: string) => notify({ type: 'success', message, title }),
    [notify]
  );
  const notifyError = useCallback(
    (message: string, title?: string) => notify({ type: 'error', message, title }),
    [notify]
  );
  const notifyInfo = useCallback(
    (message: string, title?: string) => notify({ type: 'info', message, title }),
    [notify]
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const closeConfirm = useCallback((value: boolean) => {
    setConfirmState((current) => {
      if (!current) return null;
      current.resolve(value);
      return null;
    });
  }, []);

  const contextValue = useMemo<FeedbackContextValue>(
    () => ({
      notify,
      notifySuccess,
      notifyError,
      notifyInfo,
      confirm
    }),
    [notify, notifySuccess, notifyError, notifyInfo, confirm]
  );

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}

      <div className="app-toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => {
          const meta = toastTypeMeta[toast.type];
          return (
            <article key={toast.id} className={`app-toast ${meta.className}`} role="status">
              <div className="app-toast__content">
                <p className="app-toast__title">{toast.title || meta.title}</p>
                <p className="app-toast__message">{toast.message}</p>
              </div>
              <button
                type="button"
                className="app-toast__close"
                onClick={() => removeToast(toast.id)}
                aria-label="Fechar aviso"
              >
                ×
              </button>
            </article>
          );
        })}
      </div>

      {confirmState ? (
        <div className="app-confirm-backdrop" role="presentation" onClick={() => closeConfirm(false)}>
          <div
            className="app-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label={confirmState.options.title}
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="app-confirm-modal__title">{confirmState.options.title}</h4>
            {confirmState.options.description ? (
              <p className="app-confirm-modal__description">{confirmState.options.description}</p>
            ) : null}
            <div className="app-confirm-modal__actions">
              <button
                type="button"
                className="app-button app-button-ghost"
                onClick={() => closeConfirm(false)}
              >
                {confirmState.options.cancelLabel || 'Cancelar'}
              </button>
              <button
                type="button"
                className={`app-button ${
                  confirmState.options.danger ? 'app-button-danger' : 'app-button-primary'
                }`}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.options.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback deve ser usado dentro de <FeedbackProvider>.');
  }
  return context;
}
