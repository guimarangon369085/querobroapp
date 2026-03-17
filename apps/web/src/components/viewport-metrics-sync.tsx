'use client';

import { useEffect } from 'react';

function setViewportMetrics() {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  const layoutWidth = Math.max(window.innerWidth || 0, root.clientWidth || 0);
  const layoutHeight = Math.max(window.innerHeight || 0, root.clientHeight || 0);
  const viewportWidth = Math.max(Math.round(visualViewport?.width || layoutWidth), 0);
  const viewportHeight = Math.max(Math.round(visualViewport?.height || layoutHeight), 0);
  const offsetTop = Math.max(Math.round(visualViewport?.offsetTop || 0), 0);
  const offsetLeft = Math.max(Math.round(visualViewport?.offsetLeft || 0), 0);
  const offsetRight = Math.max(layoutWidth - viewportWidth - offsetLeft, 0);
  const offsetBottom = Math.max(layoutHeight - viewportHeight - offsetTop, 0);

  root.style.setProperty('--app-viewport-width', `${viewportWidth}px`);
  root.style.setProperty('--app-viewport-height', `${viewportHeight}px`);
  root.style.setProperty('--app-viewport-offset-top', `${offsetTop}px`);
  root.style.setProperty('--app-viewport-offset-right', `${offsetRight}px`);
  root.style.setProperty('--app-viewport-offset-bottom', `${offsetBottom}px`);
  root.style.setProperty('--app-viewport-offset-left', `${offsetLeft}px`);
}

export function ViewportMetricsSync() {
  useEffect(() => {
    let frameId = 0;

    const scheduleSync = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(setViewportMetrics);
    };

    scheduleSync();
    window.addEventListener('resize', scheduleSync, { passive: true });
    window.addEventListener('orientationchange', scheduleSync, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('scroll', scheduleSync);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('orientationchange', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('scroll', scheduleSync);
    };
  }, []);

  return null;
}
