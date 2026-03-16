'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function isFocusable(element: HTMLElement) {
  return !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true';
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable);
}

type UseDialogA11yOptions = {
  isOpen: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function useDialogA11y({ isOpen, dialogRef, onClose, initialFocusRef }: UseDialogA11yOptions) {
  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';

    const focusInitialTarget = () => {
      const preferred = initialFocusRef?.current;
      if (preferred && isFocusable(preferred)) {
        preferred.focus();
        return;
      }

      const [firstFocusable] = focusableElements(dialog);
      if (firstFocusable) {
        firstFocusable.focus();
        return;
      }

      dialog.focus();
    };

    const frameId = window.requestAnimationFrame(focusInitialTarget);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const elements = focusableElements(dialog);
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === first || activeElement === dialog || !dialog.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!activeElement || activeElement === last || !dialog.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, [dialogRef, initialFocusRef, isOpen, onClose]);
}
