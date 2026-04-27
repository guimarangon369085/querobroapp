'use client';

import { useEffect } from 'react';

const chromeUaPattern = /Chrome\/\d+/;
const excludedChromeLikePattern = /Edg\/|OPR\/|Brave\/|CriOS\//;
const macOsUaPattern = /Mac OS X/;
const safariUaPattern = /Safari\/\d+/;
const excludedSafariLikePattern = /CriOS\/|FxiOS\/|EdgiOS\/|OPiOS\/|DuckDuckGo\//;
const appleTouchUaPattern = /iPhone|iPad|iPod|Macintosh/;

export function RenderStabilityGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = window.navigator.userAgent;
    const touchPoints = window.navigator.maxTouchPoints || 0;
    const isChrome =
      chromeUaPattern.test(ua) && !excludedChromeLikePattern.test(ua);
    const isMacOs = macOsUaPattern.test(ua);
    const isAppleTouchDevice =
      appleTouchUaPattern.test(ua) && touchPoints > 1;
    const isSafariLike =
      safariUaPattern.test(ua) && !excludedSafariLikePattern.test(ua);
    const shouldEnableRenderStability =
      (isChrome && isMacOs) || (isAppleTouchDevice && isSafariLike);
    if (!shouldEnableRenderStability) return;

    document.documentElement.classList.add('app-render-stability');
  }, []);

  return null;
}
