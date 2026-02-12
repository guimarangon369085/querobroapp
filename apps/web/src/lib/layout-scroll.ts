'use client';

type SearchParamsLike = {
  get(name: string): string | null;
};

type ScrollToSlotOptions = {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  focus?: boolean;
  focusSelector?: string;
  delayMs?: number;
  maxAttempts?: number;
};

function findSlotElement(slotId: string) {
  return (
    document.querySelector<HTMLElement>(`[data-layout-slot-id="${slotId}"]`) ||
    document.getElementById(`slot-${slotId}`)
  );
}

export function scrollToLayoutSlot(slotId: string, options: ScrollToSlotOptions = {}) {
  if (typeof window === 'undefined') return;

  const {
    behavior = 'smooth',
    block = 'start',
    focus = false,
    focusSelector = 'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])',
    delayMs = 0,
    maxAttempts = 6
  } = options;

  let attempts = 0;
  const run = () => {
    const target = findSlotElement(slotId);
    if (!target) {
      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(run, 80);
      }
      return;
    }

    target.scrollIntoView({ behavior, block });
    if (focus) {
      window.setTimeout(() => {
        const focusTarget = target.querySelector<HTMLElement>(focusSelector);
        focusTarget?.focus({ preventScroll: true });
      }, 120);
    }
  };

  if (delayMs > 0) {
    window.setTimeout(run, delayMs);
    return;
  }

  window.requestAnimationFrame(run);
}

export function consumeFocusQueryParam(searchParams: SearchParamsLike, key = 'focus') {
  const value = (searchParams.get(key) || '').trim();
  if (!value || typeof window === 'undefined') return '';

  const url = new URL(window.location.href);
  url.searchParams.delete(key);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);

  return value;
}
