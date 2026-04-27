'use client';

import { useEffect, useRef, type RefObject } from 'react';

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

const dialogStack: HTMLElement[] = [];

let scrollGuardsAttached = false;
let previousHtmlOverflow = '';
let previousHtmlOverscrollBehavior = '';
let previousBodyOverflow = '';
let previousBodyOverscrollBehavior = '';

function getTopDialog() {
  return dialogStack[dialogStack.length - 1] ?? null;
}

function eventTargetsTopDialog(eventTarget: EventTarget | null, dialog: HTMLElement) {
  return eventTarget instanceof Node && dialog.contains(eventTarget);
}

function preventBackgroundScroll(event: WheelEvent | TouchEvent) {
  const topDialog = getTopDialog();
  if (!topDialog) return;
  if (eventTargetsTopDialog(event.target, topDialog)) return;
  event.preventDefault();
}

function attachScrollGuards() {
  if (scrollGuardsAttached) return;
  document.addEventListener('wheel', preventBackgroundScroll, { capture: true, passive: false });
  document.addEventListener('touchmove', preventBackgroundScroll, { capture: true, passive: false });
  scrollGuardsAttached = true;
}

function detachScrollGuards() {
  if (!scrollGuardsAttached) return;
  document.removeEventListener('wheel', preventBackgroundScroll, true);
  document.removeEventListener('touchmove', preventBackgroundScroll, true);
  scrollGuardsAttached = false;
}

function lockDialogEnvironment(dialog: HTMLElement) {
  if (!dialogStack.includes(dialog)) {
    dialogStack.push(dialog);
  }

  if (dialogStack.length === 1) {
    const html = document.documentElement;
    const body = document.body;
    previousHtmlOverflow = html.style.overflow;
    previousHtmlOverscrollBehavior = html.style.overscrollBehavior;
    previousBodyOverflow = body.style.overflow;
    previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    html.classList.add('app-dialog-open');
    body.classList.add('app-dialog-open');
    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
  }

  attachScrollGuards();
}

function unlockDialogEnvironment(dialog: HTMLElement) {
  const dialogIndex = dialogStack.lastIndexOf(dialog);
  if (dialogIndex >= 0) {
    dialogStack.splice(dialogIndex, 1);
  }

  if (dialogStack.length > 0) return;

  const html = document.documentElement;
  const body = document.body;
  html.classList.remove('app-dialog-open');
  body.classList.remove('app-dialog-open');
  html.style.overflow = previousHtmlOverflow;
  html.style.overscrollBehavior = previousHtmlOverscrollBehavior;
  body.style.overflow = previousBodyOverflow;
  body.style.overscrollBehavior = previousBodyOverscrollBehavior;
  detachScrollGuards();
}

type UseDialogA11yOptions = {
  isOpen: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function useDialogA11y({ isOpen, dialogRef, onClose, initialFocusRef }: UseDialogA11yOptions) {
  // Keep the latest close handler without re-running the open/cleanup cycle on every render.
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockDialogEnvironment(dialog);

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
        onCloseRef.current();
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
      unlockDialogEnvironment(dialog);
      document.removeEventListener('keydown', onKeyDown);
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, [dialogRef, initialFocusRef, isOpen]);
}
