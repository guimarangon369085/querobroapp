'use client';

import { useEffect } from 'react';

const chromeUaPattern = /Chrome\/\d+/;
const excludedChromeLikePattern = /Edg\/|OPR\/|Brave\/|CriOS\//;
const macOsUaPattern = /Mac OS X/;

export function RenderStabilityGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = window.navigator.userAgent;
    const isChrome =
      chromeUaPattern.test(ua) && !excludedChromeLikePattern.test(ua);
    const isMacOs = macOsUaPattern.test(ua);
    if (!isChrome || !isMacOs) return;

    document.documentElement.classList.add('app-render-stability');
  }, []);

  return null;
}

