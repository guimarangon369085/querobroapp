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
  throttleMs?: number;
};

const lastScrollAt = new Map<string, number>();

function findSlotElement(slotId: string) {
  return (
    document.querySelector<HTMLElement>(`[data-layout-slot-id="${slotId}"]`) ||
    document.getElementById(`slot-${slotId}`)
  );
}

function resolveTopOverlayOffset() {
  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>('.app-topbar, [data-scroll-overlay="top"]')
  );

  return overlays.reduce((maxOffset, element) => {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return maxOffset;
    }

    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= 0) {
      return maxOffset;
    }

    return Math.max(maxOffset, rect.height + Math.max(rect.top, 0));
  }, 12);
}

export function scrollToLayoutSlot(slotId: string, options: ScrollToSlotOptions = {}) {
  if (typeof window === 'undefined') return;

  const {
    behavior = 'smooth',
    block = 'start',
    focus = false,
    focusSelector = 'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])',
    delayMs = 0,
    maxAttempts = 6,
    throttleMs = 800
  } = options;

  const now = Date.now();
  const last = lastScrollAt.get(slotId) ?? 0;
  if (now - last < throttleMs) return;
  lastScrollAt.set(slotId, now);

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

    const overlayOffset = block === 'start' ? resolveTopOverlayOffset() : 12;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - overlayOffset - 12;
    window.scrollTo({
      top: Math.max(targetTop, 0),
      behavior
    });
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
