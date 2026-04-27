'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useDialogA11y } from '@/lib/use-dialog-a11y';

type ToastType = 'success' | 'error' | 'info';

type ToastInput = {
  type: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
};

type ToastItem = Omit<ToastInput, 'durationMs'> & {
  id: string;
  durationMs: number;
  createdAt: number;
  expiresAt: number;
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

type AlertOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: ToastType;
};

type AlertState = {
  options: AlertOptions;
};

type FeedbackContextValue = {
  notify: (input: ToastInput) => void;
  notifySuccess: (message: string, title?: string) => void;
  notifyError: (message: string, title?: string) => void;
  notifyInfo: (message: string, title?: string) => void;
  notifyUndo: (message: string, onUndo: () => void | Promise<void>, title?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  present: (options: AlertOptions) => void;
  presentSuccess: (message: string, title?: string) => void;
  presentError: (message: string, title?: string) => void;
  presentInfo: (message: string, title?: string) => void;
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

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [alertState, setAlertState] = useState<AlertState | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const pendingConfirmRef = useRef<ConfirmState | null>(null);
  const confirmDialogRef = useRef<HTMLDivElement | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmActionRef = useRef<HTMLButtonElement | null>(null);
  const alertDialogRef = useRef<HTMLDivElement | null>(null);
  const alertActionRef = useRef<HTMLButtonElement | null>(null);
  const confirmTitleId = useId();
  const confirmDescriptionId = useId();
  const alertTitleId = useId();
  const alertDescriptionId = useId();

  useEffect(() => {
    pendingConfirmRef.current = confirmState;
  }, [confirmState]);

  useEffect(() => {
    return () => {
      pendingConfirmRef.current?.resolve(false);
    };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [toasts.length]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (input: ToastInput) => {
      const id = randomId();
      const createdAt = Date.now();
      const durationMs = Math.max(
        1200,
        input.durationMs ?? (input.actionLabel && input.onAction ? 7600 : 3800)
      );
      const nextToast: ToastItem = {
        id,
        durationMs,
        createdAt,
        expiresAt: createdAt + durationMs,
        ...input
      };
      setToasts((prev) => [nextToast, ...prev].slice(0, 5));

      window.setTimeout(() => removeToast(id), durationMs);
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
  const notifyUndo = useCallback(
    (message: string, onUndo: () => void | Promise<void>, title?: string) =>
      notify({
        type: 'info',
        title: title || 'Acao removida',
        message,
        actionLabel: 'Desfazer',
        onAction: onUndo
      }),
    [notify]
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const present = useCallback((options: AlertOptions) => {
    setAlertState({ options });
  }, []);

  const presentSuccess = useCallback(
    (message: string, title?: string) =>
      present({
        tone: 'success',
        title: title || 'Sucesso',
        description: message,
        confirmLabel: 'Continuar'
      }),
    [present]
  );

  const presentError = useCallback(
    (message: string, title?: string) =>
      present({
        tone: 'error',
        title: title || 'Erro',
        description: message,
        confirmLabel: 'Fechar'
      }),
    [present]
  );

  const presentInfo = useCallback(
    (message: string, title?: string) =>
      present({
        tone: 'info',
        title: title || 'Aviso',
        description: message,
        confirmLabel: 'Entendi'
      }),
    [present]
  );

  const closeConfirm = useCallback((value: boolean) => {
    setConfirmState((current) => {
      if (!current) return null;
      current.resolve(value);
      return null;
    });
  }, []);

  const closeAlert = useCallback(() => {
    setAlertState(null);
  }, []);

  useDialogA11y({
    isOpen: Boolean(confirmState),
    dialogRef: confirmDialogRef,
    initialFocusRef: confirmCancelRef,
    onClose: () => closeConfirm(false)
  });

  useDialogA11y({
    isOpen: Boolean(alertState),
    dialogRef: alertDialogRef,
    initialFocusRef: alertActionRef,
    onClose: closeAlert
  });

  const runToastAction = useCallback(
    async (toast: ToastItem) => {
      if (!toast.onAction) return;
      removeToast(toast.id);
      try {
        await toast.onAction();
      } catch (err) {
        notify({
          type: 'error',
          title: 'Falha ao desfazer',
          message: err instanceof Error ? err.message : 'Não foi possível desfazer a ação.'
        });
      }
    },
    [notify, removeToast]
  );

  const contextValue = useMemo<FeedbackContextValue>(
    () => ({
      notify,
      notifySuccess,
      notifyError,
      notifyInfo,
      notifyUndo,
      confirm,
      present,
      presentSuccess,
      presentError,
      presentInfo
    }),
    [
      confirm,
      notify,
      notifyError,
      notifyInfo,
      notifySuccess,
      notifyUndo,
      present,
      presentError,
      presentInfo,
      presentSuccess
    ]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;

      if (confirmState || alertState) {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (confirmState) {
            closeConfirm(false);
          } else {
            closeAlert();
          }
        }
        return;
      }

      if (event.key !== 'Enter') return;
      if (isTypingTarget(event.target)) return;

      const actionableToast = toasts.find((toast) => toast.actionLabel && toast.onAction);
      if (!actionableToast) return;

      event.preventDefault();
      void runToastAction(actionableToast);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [alertState, closeAlert, closeConfirm, confirmState, runToastAction, toasts]);

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}

      <div className="app-toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => {
          const meta = toastTypeMeta[toast.type];
          const remainingMs = Math.max(0, toast.expiresAt - nowTick);
          const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
          const countdownRatio =
            toast.durationMs > 0 ? Math.max(0, Math.min(1, remainingMs / toast.durationMs)) : 0;
          return (
            <article key={toast.id} className={`app-toast ${meta.className}`} role="status">
              <div className="app-toast__content">
                <p className="app-toast__title">{toast.title || meta.title}</p>
                <p className="app-toast__message">{toast.message}</p>
                {toast.actionLabel && toast.onAction ? (
                  <>
                    <div className="app-toast__undo-row">
                      <button
                        type="button"
                        className="app-toast__action"
                        onClick={() => runToastAction(toast)}
                      >
                        {toast.actionLabel}
                      </button>
                      <span className="app-toast__timer">{remainingSeconds}s</span>
                    </div>
                    <div className="app-toast__countdown" aria-hidden="true">
                      <span
                        className="app-toast__countdown-fill"
                        style={{ transform: `scaleX(${countdownRatio})` }}
                      />
                    </div>
                  </>
                ) : null}
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
            ref={confirmDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            aria-describedby={confirmState.options.description ? confirmDescriptionId : undefined}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id={confirmTitleId} className="app-confirm-modal__title">
              {confirmState.options.title}
            </h4>
            {confirmState.options.description ? (
              <p id={confirmDescriptionId} className="app-confirm-modal__description">
                {confirmState.options.description}
              </p>
            ) : null}
            <div className="app-confirm-modal__actions">
              <button
                type="button"
                className="app-button app-button-ghost"
                ref={confirmCancelRef}
                onClick={() => closeConfirm(false)}
              >
                {confirmState.options.cancelLabel || 'Cancelar'}
              </button>
              <button
                type="button"
                className={`app-button ${
                  confirmState.options.danger ? 'app-button-danger' : 'app-button-primary'
                }`}
                ref={confirmActionRef}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.options.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {alertState ? (
        <div className="app-alert-backdrop" role="presentation" onClick={closeAlert}>
          <div
            className={`app-alert-modal app-alert-modal--${alertState.options.tone || 'info'}`}
            ref={alertDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={alertTitleId}
            aria-describedby={alertState.options.description ? alertDescriptionId : undefined}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="app-alert-modal__eyebrow">
              {alertState.options.tone === 'success'
                ? 'Concluido'
                : alertState.options.tone === 'error'
                  ? 'Atencao'
                  : 'Aviso'}
            </p>
            <h4 id={alertTitleId} className="app-alert-modal__title">
              {alertState.options.title}
            </h4>
            {alertState.options.description ? (
              <p id={alertDescriptionId} className="app-alert-modal__description">
                {alertState.options.description}
              </p>
            ) : null}
            <div className="app-alert-modal__actions">
              <button
                type="button"
                className={`app-button ${
                  alertState.options.tone === 'error' ? 'app-button-danger' : 'app-button-primary'
                }`}
                ref={alertActionRef}
                onClick={closeAlert}
              >
                {alertState.options.confirmLabel || 'Fechar'}
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
